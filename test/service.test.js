import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createSupabase } from '../server/supabase.js';
import { demoProvider } from '../server/ai/demo.js';
import { loadConfig } from '../server/config.js';
import { startFakeSupabase, ANON, SERVICE } from './fake-supabase.js';

const silent = { error() {}, log() {} };
const wait = async (fn, ms = 5000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };
const audio = Buffer.from('RIFFfakeaudio-bytes-0123456789');
const as = (token, extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra });

async function boot() {
  const fake = await startFakeSupabase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'confere-svc-'));
  const config = loadConfig({ DATA_DIR: dir, MAX_UPLOAD_MB: '1' });
  const supabase = createSupabase({ url: fake.url, anonKey: ANON, serviceKey: SERVICE });
  const app = await createApp({ config, provider: demoProvider, supabase, log: silent });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { base, fake, close: async () => { app.server.close(); fake.close(); await fs.rm(dir, { recursive: true, force: true }); } };
}
const upload = (base, token, qs = 'title=Teste&filename=a.wav&duration=30') =>
  fetch(`${base}/api/meetings?${qs}`, { method: 'POST', headers: as(token, { 'Content-Type': 'audio/wav' }), body: audio });

test('modo serviço: sem login, a API recusa; a página e /api/config continuam públicas', async () => {
  const s = await boot();
  try {
    assert.equal((await fetch(`${s.base}/api/meetings`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/meetings`, { headers: as('token-falso') })).status, 401);
    assert.equal((await fetch(`${s.base}/`)).status, 200);
    const cfg = await (await fetch(`${s.base}/api/config`)).json();
    assert.equal(cfg.auth, true);
    assert.ok(!JSON.stringify(cfg).includes(SERVICE));
  } finally { await s.close(); }
});

test('fluxo do usuário: envia, processa com a chave de serviço, debita minutos, lê o áudio e exclui', async () => {
  const s = await boot();
  try {
    const r = await upload(s.base, 'tok-A');
    assert.equal(r.status, 202);
    const { id } = await r.json();
    const m = await wait(async () => { const x = await (await fetch(`${s.base}/api/meetings/${id}`, { headers: as('tok-A') })).json(); return x.status === 'ready' && x; });
    assert.equal(m.result.tasks.length > 0, true);
    assert.ok(s.fake.state.objects.has(`user-a/${id}`), 'áudio salvo na pasta do usuário');
    // cobrança: duração da transcrição de demonstração (36 s) ou a informada (30 s), a maior
    const consumed = s.fake.state.consumed;
    assert.equal(consumed.length, 1);
    assert.deepEqual([consumed[0].p_user, consumed[0].p_meeting], ['user-a', id]);
    assert.equal(consumed[0].p_seconds, 36);
    // o pipeline usou a chave de serviço; as rotas do usuário usaram o token dele
    const rpc = s.fake.state.calls.find((c) => c.path.endsWith('consume_seconds'));
    assert.equal(rpc.bearer, SERVICE);
    const mine = s.fake.state.calls.filter((c) => c.path === '/rest/v1/meetings' && c.bearer === 'tok-A');
    assert.ok(mine.length > 0);
    // áudio com Range
    const a = await fetch(`${s.base}/api/meetings/${id}/audio`, { headers: as('tok-A', { Range: 'bytes=0-3' }) });
    assert.equal(a.status, 206);
    assert.equal(await a.text(), 'RIFF');
    // /api/me
    const me = await (await fetch(`${s.base}/api/me`, { headers: as('tok-A') })).json();
    assert.equal(me.email, 'a@x.com');
    assert.equal(me.quota.plan_id, 'teste');
    // exclusão apaga linha e objeto
    assert.equal((await fetch(`${s.base}/api/meetings/${id}`, { method: 'DELETE', headers: as('tok-A') })).status, 204);
    assert.equal(s.fake.state.meetings.length, 0);
    assert.equal(s.fake.state.objects.size, 0);
  } finally { await s.close(); }
});

test('isolamento: usuário B não vê, lê, altera nem apaga a reunião de A', async () => {
  const s = await boot();
  try {
    const { id } = await (await upload(s.base, 'tok-A')).json();
    await wait(async () => (await (await fetch(`${s.base}/api/meetings/${id}`, { headers: as('tok-A') })).json()).status === 'ready');
    assert.deepEqual(await (await fetch(`${s.base}/api/meetings`, { headers: as('tok-B') })).json(), []);
    assert.equal((await fetch(`${s.base}/api/meetings/${id}`, { headers: as('tok-B') })).status, 404);
    assert.equal((await fetch(`${s.base}/api/meetings/${id}/audio`, { headers: as('tok-B') })).status, 404);
    assert.equal((await fetch(`${s.base}/api/meetings/${id}`, { method: 'DELETE', headers: as('tok-B') })).status, 404);
    assert.equal(s.fake.state.meetings.length, 1);
  } finally { await s.close(); }
});

test('saldo: bloqueia envio sem saldo, com teste expirado ou com gravação maior que o saldo', async () => {
  const s = await boot();
  try {
    s.fake.state.quotas.set('user-a', { plan_id: 'teste', active: true, can_process: false, plan_seconds_remaining: 0, extra_seconds: 0 });
    let r = await upload(s.base, 'tok-A');
    assert.equal(r.status, 402);
    assert.match((await r.json()).error, /saldo de minutos acabou/);
    s.fake.state.quotas.set('user-a', { plan_id: 'teste', active: false, can_process: false, plan_seconds_remaining: 0, extra_seconds: 0 });
    r = await upload(s.base, 'tok-A');
    assert.match((await r.json()).error, /período de teste/);
    s.fake.state.quotas.set('user-a', { plan_id: 'teste', active: true, can_process: true, plan_seconds_remaining: 300, extra_seconds: 0 });
    r = await upload(s.base, 'tok-A', 'title=x&duration=1200');
    assert.equal(r.status, 402);
    assert.match((await r.json()).error, /20 min.*5 min/);
    assert.equal(s.fake.state.meetings.length, 0, 'nada é criado quando bloqueado');
  } finally { await s.close(); }
});

test('login/cadastro: proxy com mensagens em português e sem vazar existência de e-mail na recuperação', async () => {
  const s = await boot();
  try {
    const post = (p, body) => fetch(`${s.base}/api/auth/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let r = await post('login', { email: 'a@x.com', password: 'senha-errada' });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /incorretos/);
    r = await post('login', { email: 'a@x.com', password: 'senha-correta' });
    const sess = await r.json();
    assert.equal(sess.access_token, 'tok-A'); assert.equal(sess.user.email, 'a@x.com');
    assert.ok(!('password' in sess));
    r = await post('signup', { email: 'novo@x.com', password: 'curta' });
    assert.match((await r.json()).error, /8 caracteres/);
    r = await post('signup', { email: 'novo@x.com', password: 'longa-o-bastante' });
    assert.deepEqual(await r.json(), { needsConfirmation: true });
    r = await post('signup', { email: 'novo@x.com', password: 'longa-o-bastante' });
    assert.match((await r.json()).error, /já está cadastrado/);
    r = await post('signup', { email: 'sem-arroba', password: 'longa-o-bastante' });
    assert.match((await r.json()).error, /e-mail válido/);
    const a = await (await post('recover', { email: 'a@x.com' })).json();
    const b = await (await post('recover', { email: 'naoexiste@x.com' })).json();
    assert.deepEqual(a, b);
    r = await post('refresh', { refresh_token: 'refresh-ok' });
    assert.equal((await r.json()).access_token, 'tok-A');
    r = await post('refresh', { refresh_token: 'velho' });
    assert.match((await r.json()).error, /Sessão expirada/);
    // a requisição ao Auth usou a chave pública, nunca a de serviço
    const authCalls = s.fake.state.calls.filter((c) => c.path.startsWith('/auth/v1/') && c.path !== '/auth/v1/user');
    assert.ok(authCalls.every((c) => c.apikey === ANON && c.bearer === undefined));
  } finally { await s.close(); }
});
