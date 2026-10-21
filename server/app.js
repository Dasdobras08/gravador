import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
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

export async function createApp({ config, provider, log = console }) {
  const store = new Store(config.dataDir);
  await store.init();
  const pipeline = new Pipeline({ store, provider, log });

  const needMeeting = async (id) => {
    const m = await store.get(id);
    if (!m) throw new HttpError(404, 'Reunião não encontrada.');
    return m;
  };

  async function serveAudio(req, res, m) {
    const file = store.audioPath(m.id);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) throw new HttpError(404, 'Áudio não encontrado.');
    const headers = { 'Content-Type': m.mime || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
      end = Math.min(end, stat.size - 1);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
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

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const method = req.method;

    // Proteção contra requisições de outros sites (CSRF) contra o servidor local.
    if (method !== 'GET' && method !== 'HEAD' && req.headers.origin) {
      const o = new URL(req.headers.origin);
      if (o.host !== req.headers.host) throw new HttpError(403, 'Origem não permitida.');
    }

    if (!pathname.startsWith('/api/')) return serveStatic(res, pathname);

    if (pathname === '/api/config' && method === 'GET') {
      return json(res, 200, {
        provider: provider.name, demo: provider.demo,
        maxUploadMb: Math.floor(config.maxUploadBytes / 1048576),
      });
    }

    if (pathname === '/api/meetings' && method === 'GET') {
      return json(res, 200, (await store.list()).map(summary));
    }

    if (pathname === '/api/meetings' && method === 'POST') {
      const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!AUDIO_TYPES.test(mime)) throw new HttpError(415, 'Formato não suportado. Envie um arquivo de áudio (ex.: mp3, m4a, wav, webm, ogg).');
      const body = await readBody(req, config.maxUploadBytes);
      if (!body.length) throw new HttpError(400, 'O arquivo está vazio.');
      const filename = (url.searchParams.get('filename') || 'gravacao').slice(0, 200);
      const source = url.searchParams.get('source') === 'gravacao' ? 'gravacao' : 'arquivo';
      const dur = Number(url.searchParams.get('duration'));
      const title = (url.searchParams.get('title') || '').trim().slice(0, 200)
        || (source === 'gravacao' ? `Reunião de ${new Date().toLocaleString('pt-BR')}` : filename.replace(/\.[^.]+$/, ''));
      const m = await store.create({ title, filename, mime, source, durationSec: Number.isFinite(dur) && dur > 0 ? dur : null, marks: sanitizeMarks(url.searchParams.get('marks')) });
      await fsp.writeFile(store.audioPath(m.id), body, { mode: 0o600 });
      pipeline.enqueue(m.id);
      return json(res, 202, summary(m));
    }

    const match = pathname.match(/^\/api\/meetings\/([^/]+)(?:\/([a-z.]+))?$/);
    if (match) {
      const [, id, sub] = match;
      if (!sub && method === 'GET') return json(res, 200, await needMeeting(id));

      if (!sub && method === 'DELETE') {
        await needMeeting(id);
        await store.remove(id);
        res.writeHead(204); return res.end();
      }

      if (!sub && method === 'PATCH') {
        const m = await needMeeting(id);
        const body = JSON.parse((await readBody(req, 2 * 1048576)).toString('utf8') || '{}');
        if (typeof body.title === 'string' && body.title.trim()) m.title = body.title.trim().slice(0, 200);
        if (body.result) {
          if (m.status !== 'ready' || !m.result) throw new HttpError(409, 'O resumo ainda não está pronto para edição.');
          m.result = sanitizeEdit(body.result, m.result, m.transcript.segments.length);
        }
        await store.save(m);
        return json(res, 200, m);
      }

      if (sub === 'retry' && method === 'POST') {
        const m = await needMeeting(id);
        if (m.status !== 'error') throw new HttpError(409, 'Só é possível reprocessar reuniões com erro.');
        m.status = m.transcript ? 'summarizing' : 'transcribing';
        m.error = null;
        await store.save(m);
        pipeline.enqueue(id);
        return json(res, 202, summary(m));
      }

      if (sub === 'audio' && method === 'GET') return serveAudio(req, res, await needMeeting(id));

      if (sub === 'export.md' && method === 'GET') {
        const m = await needMeeting(id);
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

  return { server, store, pipeline };
}
