import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { SupabaseStore } from './supabase-store.js';
import { createQuota } from './quota.js';
import { Pipeline } from './pipeline.js';
import { sanitizeEdit, sanitizeMarks } from './schema.js';
import { toMarkdown } from './markdown.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const AUDIO_TYPES = /^(audio|video)\/|^application\/ogg$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

// A lista não precisa da transcrição inteira.
const summary = (m) => ({
  id: m.id, title: m.title, status: m.status, error: m.error, failedStage: m.failedStage,
  demo: m.demo, source: m.source, durationSec: m.durationSec, createdAt: m.createdAt,
});

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) return reject(new HttpError(413, `O arquivo excede o limite de ${Math.floor(limit / 1048576)} MB.`));
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, `O arquivo excede o limite de ${Math.floor(limit / 1048576)} MB.`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();

/** Confere o cabeçalho Basic contra a senha configurada (comparação em tempo constante). */
export function passwordOk(header, password) {
  const m = /^Basic\s+(.+)$/i.exec(header || '');
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const given = decoded.slice(decoded.indexOf(':') + 1);
  return crypto.timingSafeEqual(digest(given), digest(password));
}

const GOTRUE_MESSAGES = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  user_already_exists: 'Este e-mail já está cadastrado. Tente entrar.',
  email_exists: 'Este e-mail já está cadastrado. Tente entrar.',
  weak_password: 'Senha fraca: use pelo menos 8 caracteres.',
  email_not_confirmed: 'Confirme seu e-mail (veja a caixa de entrada) antes de entrar.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  over_email_send_rate_limit: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
};
const gotrueMessage = (data) => GOTRUE_MESSAGES[data?.error_code] || 'Não foi possível concluir. Confira os dados e tente de novo.';
const session = (d) => ({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at, user: { id: d.user?.id, email: d.user?.email } });
const bearerOf = (req) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1] || null;
const fmtMin = (sec) => `${Math.floor(sec / 60)} min`;

export async function createApp({ config, provider, supabase = null, log = console }) {
  const localStore = new Store(config.dataDir);
  const service = Boolean(supabase);
  // Modo serviço: o pipeline usa a chave de serviço; as rotas usam o token de cada usuário (RLS).
  const baseStore = service ? new SupabaseStore(supabase, 'service') : localStore;
  const quota = service ? createQuota(supabase) : null;
  if (!service) await localStore.init();
  const pipeline = new Pipeline({ store: baseStore, provider, quota, log });
  const store = baseStore;

  const needMeeting = async (st, id) => {
    const m = await st.get(id);
    if (!m) throw new HttpError(404, 'Reunião não encontrada.');
    return m;
  };

  async function serveAudio(st, req, res, m) {
    const a = await st.audio(m.id, req.headers.range, m.mime);
    if (!a) throw new HttpError(404, 'Áudio não encontrado.');
    res.writeHead(a.status, { ...a.headers, 'Cache-Control': 'private, no-store' });
    if (a.stream) a.stream.pipe(res); else res.end();
  }

  async function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Não encontrado.');
    const data = await fsp.readFile(file).catch(() => null);
    if (!data) throw new HttpError(404, 'Não encontrado.');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // Microfone só neste domínio; sem scripts de terceiros.
      'Content-Security-Policy': "default-src 'self'; media-src 'self' blob:; style-src 'self'; frame-ancestors 'none'",
      'Permissions-Policy': 'microphone=(self)',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  }

  /** Rotas de login/cadastro: repassam ao Supabase Auth com a chave pública (o navegador nunca fala com ele). */
  async function authRoute(req, res, pathname) {
    const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}');
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const bad = (m) => { throw new HttpError(400, m); };
    if (pathname !== '/api/auth/refresh' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('Informe um e-mail válido.');
    if (pathname === '/api/auth/signup' && password.length < 8) bad('A senha precisa ter pelo menos 8 caracteres.');
    if (pathname === '/api/auth/login' && !password) bad('Informe a senha.');

    if (pathname === '/api/auth/recover') {
      await supabase.authCall('/recover', { email }).catch(() => null);
      return json(res, 200, { ok: true }); // sempre igual: não revela se o e-mail existe
    }
    let r;
    if (pathname === '/api/auth/signup') r = await supabase.authCall('/signup', { email, password });
    else if (pathname === '/api/auth/login') r = await supabase.authCall('/token?grant_type=password', { email, password });
    else if (pathname === '/api/auth/refresh') r = await supabase.authCall('/token?grant_type=refresh_token', { refresh_token: String(body.refresh_token || '') });
    else throw new HttpError(404, 'Rota não encontrada.');
    if (!r.ok) throw new HttpError(r.status >= 500 ? 502 : 400, r.status === 400 && pathname === '/api/auth/refresh' ? 'Sessão expirada. Entre novamente.' : gotrueMessage(r.data));
    if (!r.data.access_token) return json(res, 200, { needsConfirmation: true }); // cadastro exige confirmar o e-mail
    return json(res, 200, session(r.data));
  }

  async function route(req, res) {
    if (config.appPassword && !passwordOk(req.headers.authorization, config.appPassword)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Confere", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Senha necessária.');
    }
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const method = req.method;

    // Proteção contra requisições de outros sites (CSRF) contra o servidor local.
    if (method !== 'GET' && method !== 'HEAD' && req.headers.origin) {
      const o = new URL(req.headers.origin);
      if (o.host !== req.headers.host) throw new HttpError(403, 'Origem não permitida.');
    }

    if (!pathname.startsWith('/api/')) return serveStatic(res, pathname);

    if (service && pathname.startsWith('/api/auth/') && method === 'POST') return authRoute(req, res, pathname);

    // Modo serviço: tudo em /api/ (exceto /api/config) exige um usuário autenticado.
    let st = store;
    let user = null;
    if (service && pathname !== '/api/config') {
      const token = bearerOf(req);
      user = await supabase.getUser(token);
      if (!user) { res.setHeader('X-Auth', 'required'); throw new HttpError(401, 'Faça login para continuar.'); }
      st = baseStore.forUser(token);
    }

    if (pathname === '/api/config' && method === 'GET') {
      return json(res, 200, {
        provider: provider.name, demo: provider.demo, auth: service,
        maxUploadMb: Math.floor(config.maxUploadBytes / 1048576),
      });
    }

    if (pathname === '/api/me' && method === 'GET') {
      return json(res, 200, service ? { email: user.email, quota: await quota.mine(bearerOf(req)) } : { local: true });
    }

    if (pathname === '/api/meetings' && method === 'GET') {
      return json(res, 200, (await st.list()).map(summary));
    }

    if (pathname === '/api/meetings' && method === 'POST') {
      const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!AUDIO_TYPES.test(mime)) throw new HttpError(415, 'Formato não suportado. Envie um arquivo de áudio (ex.: mp3, m4a, wav, webm, ogg).');
      const dur = Number(url.searchParams.get('duration'));
      if (service) {
        const q = await quota.mine(bearerOf(req));
        if (!q?.can_process) {
          throw new HttpError(402, q?.active === false
            ? 'Seu período de teste ou assinatura terminou. Escolha um plano para continuar transcrevendo.'
            : 'Seu saldo de minutos acabou. Aguarde a renovação do plano ou compre minutos extras.');
        }
        const left = q.plan_seconds_remaining + q.extra_seconds;
        if (Number.isFinite(dur) && dur > left) {
          throw new HttpError(402, `Esta gravação tem ${fmtMin(dur)}, mas seu saldo é de ${fmtMin(left)}. Compre minutos extras ou mude de plano.`);
        }
      }
      const body = await readBody(req, config.maxUploadBytes);
      if (!body.length) throw new HttpError(400, 'O arquivo está vazio.');
      const filename = (url.searchParams.get('filename') || 'gravacao').slice(0, 200);
      const source = url.searchParams.get('source') === 'gravacao' ? 'gravacao' : 'arquivo';
      const title = (url.searchParams.get('title') || '').trim().slice(0, 200)
        || (source === 'gravacao' ? `Reunião de ${new Date().toLocaleString('pt-BR')}` : filename.replace(/\.[^.]+$/, ''));
      const m = await st.create({ title, filename, mime, source, durationSec: Number.isFinite(dur) && dur > 0 ? dur : null, marks: sanitizeMarks(url.searchParams.get('marks')) });
      try { await st.putAudio(m.id, body, mime); }
      catch (e) { await st.remove(m.id).catch(() => {}); throw e; }
      pipeline.enqueue(m.id);
      return json(res, 202, summary(m));
    }

    const match = pathname.match(/^\/api\/meetings\/([^/]+)(?:\/([a-z.]+))?$/);
    if (match) {
      const [, id, sub] = match;
      if (!sub && method === 'GET') return json(res, 200, await needMeeting(st, id));

      if (!sub && method === 'DELETE') {
        await needMeeting(st, id);
        await st.remove(id);
        res.writeHead(204); return res.end();
      }

      if (!sub && method === 'PATCH') {
        const m = await needMeeting(st, id);
        const body = JSON.parse((await readBody(req, 2 * 1048576)).toString('utf8') || '{}');
        if (typeof body.title === 'string' && body.title.trim()) m.title = body.title.trim().slice(0, 200);
        if (body.result) {
          if (m.status !== 'ready' || !m.result) throw new HttpError(409, 'O resumo ainda não está pronto para edição.');
          m.result = sanitizeEdit(body.result, m.result, m.transcript.segments.length);
        }
        await st.save(m);
        return json(res, 200, m);
      }

      if (sub === 'retry' && method === 'POST') {
        const m = await needMeeting(st, id);
        if (m.status !== 'error') throw new HttpError(409, 'Só é possível reprocessar reuniões com erro.');
        m.status = m.transcript ? 'summarizing' : 'transcribing';
        m.error = null;
        await st.save(m);
        pipeline.enqueue(id);
        return json(res, 202, summary(m));
      }

      if (sub === 'audio' && method === 'GET') return serveAudio(st, req, res, await needMeeting(st, id));

      if (sub === 'export.md' && method === 'GET') {
        const m = await needMeeting(st, id);
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="reuniao-${m.id.slice(0, 8)}.md"`,
        });
        return res.end(toMarkdown(m));
      }
    }
    throw new HttpError(404, 'Rota não encontrada.');
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      const status = e instanceof SyntaxError ? 400 : e.status || 500;
      if (status === 500) log.error('[http]', e);
      if (res.headersSent) return res.destroy();
      json(res, status, { error: status === 500 ? 'Erro interno do servidor.' : e instanceof SyntaxError ? 'Requisição inválida.' : e.message });
    });
  });

  return { server, store: baseStore, pipeline };
}
