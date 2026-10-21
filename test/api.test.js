import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { demoProvider } from '../server/ai/demo.js';
import { createOpenAIProvider } from '../server/ai/openai.js';
import { loadConfig } from '../server/config.js';

const silent = { error() {}, log() {} };
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
const wait = async (fn, ms = 5000) => {
  const t = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); }
};
const audio = Buffer.from('RIFFfakeaudio-bytes-0123456789');

async function boot(provider, extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gravador-'));
  const config = { ...loadConfig({ DATA_DIR: dir, MAX_UPLOAD_MB: '1' }), ...extra };
  const app = await createApp({ config, provider, log: silent });
  const base = await listen(app.server);
  return { base, dir, app, close: () => { app.server.close(); return fs.rm(dir, { recursive: true, force: true }); } };
}
const upload = (base, qs = 'title=Teste&filename=a.wav', body = audio, type = 'audio/wav') =>
  fetch(`${base}/api/meetings?${qs}`, { method: 'POST', headers: { 'Content-Type': type }, body });

test('modo demonstração: fluxo completo, resultado marcado como demo', async () => {
  const s = await boot(demoProvider);
  try {
    const res = await upload(s.base);
    assert.equal(res.status, 202);
    const { id } = await res.json();
    const m = await wait(async () => { const x = await (await fetch(`${s.base}/api/meetings/${id}`)).json(); return x.status === 'ready' && x; });
    assert.equal(m.demo, true);
    assert.match(m.result.warnings[0], /DEMONSTRAÇÃO/);
    const task = m.result.tasks.find((t) => t.owner);
    assert.equal(task.owner, 'Pessoa B');
    assert.equal(m.result.tasks.find((t) => !t.owner).deadline, null);
    assert.ok(m.result.tasks.some((t) => t.origin === 'sugestao_ia'));

    // edição
    const edited = structuredClone(m.result);
    edited.decisions[0].text = 'Decisão corrigida';
    const p = await fetch(`${s.base}/api/meetings/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: edited }) });
    assert.equal(p.status, 200);
    assert.equal((await p.json()).result.decisions[0].edited, true);

    // exportação
    const md = await (await fetch(`${s.base}/api/meetings/${id}/export.md`)).text();
    assert.match(md, /DEMONSTRAÇÃO/);
    assert.match(md, /responsável: não especificado/);
    assert.match(md, /sugestão da IA/);

    // áudio com Range
    const r = await fetch(`${s.base}/api/meetings/${id}/audio`, { headers: { Range: 'bytes=0-3' } });
    assert.equal(r.status, 206);
    assert.equal(await r.text(), 'RIFF');

    // exclusão remove tudo
    assert.equal((await fetch(`${s.base}/api/meetings/${id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${s.base}/api/meetings/${id}`)).status, 404);
    assert.deepEqual(await fs.readdir(path.join(s.dir, 'meetings')), []);
    assert.equal((await fetch(`${s.base}/api/meetings/${id}/audio`)).status, 404);
  } finally { await s.close(); }
});

test('validações de upload', async () => {
  const s = await boot(demoProvider);
  try {
    assert.equal((await upload(s.base, 'x=1', audio, 'text/plain')).status, 415);
    assert.equal((await upload(s.base, 'x=1', Buffer.alloc(0))).status, 400);
    const big = await upload(s.base, 'x=1', Buffer.alloc(1024 * 1024 + 10));
    assert.equal(big.status, 413);
    assert.equal((await fetch(`${s.base}/api/meetings/..%2F..%2Fetc`)).status, 400);
    const cross = await fetch(`${s.base}/api/meetings`, { method: 'POST', headers: { Origin: 'http://evil.example', 'Content-Type': 'audio/wav' }, body: audio });
    assert.equal(cross.status, 403);
    assert.equal((await fetch(`${s.base}/../server/app.js`)).status, 404);
  } finally { await s.close(); }
});

test('erro de transcrição aparece com mensagem clara e pode ser reprocessado', async () => {
  let ok = false;
  const flaky = { name: 'flaky', demo: false,
    async transcribe() { if (!ok) throw new Error('Serviço fora do ar.'); return [{ start: 0, end: 2, text: 'Olá a todos.' }]; },
    async summarize() { return { overview: 'x', topics: [], decisions: [], tasks: [], warnings: [] }; } };
  const s = await boot(flaky);
  try {
    const { id } = await (await upload(s.base)).json();
    const failed = await wait(async () => { const x = await (await fetch(`${s.base}/api/meetings/${id}`)).json(); return x.status === 'error' && x; });
    assert.equal(failed.error, 'Serviço fora do ar.');
    assert.equal(failed.failedStage, 'transcribing');
    ok = true;
    assert.equal((await fetch(`${s.base}/api/meetings/${id}/retry`, { method: 'POST' })).status, 202);
    await wait(async () => (await (await fetch(`${s.base}/api/meetings/${id}`)).json()).status === 'ready');
    assert.equal((await fetch(`${s.base}/api/meetings/${id}/retry`, { method: 'POST' })).status, 409);
  } finally { await s.close(); }
});

test('transcrição vazia vira erro, não resumo inventado', async () => {
  const empty = { name: 'empty', demo: false, async transcribe() { return []; }, async summarize() { throw new Error('não deveria ser chamado'); } };
  const s = await boot(empty);
  try {
    const { id } = await (await upload(s.base)).json();
    const m = await wait(async () => { const x = await (await fetch(`${s.base}/api/meetings/${id}`)).json(); return x.status === 'error' && x; });
    assert.match(m.error, /Nenhuma fala/);
    assert.equal(m.result, null);
  } finally { await s.close(); }
});

test('provedor OpenAI-compatível (servidor simulado): transcrição, resumo e saneamento', async () => {
  const seen = [];
  const fake = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    seen.push({ url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString('latin1') });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/audio/transcriptions') {
      return res.end(JSON.stringify({ segments: [
        { start: 0, end: 4, text: 'Ana fica responsável pelo relatório.' },
        { start: 4, end: 8, text: 'Fechamos o escopo do projeto.' }] }));
    }
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      overview: 'Reunião curta.',
      topics: [{ title: 'Escopo', points: [{ text: 'Escopo fechado', origin: 'dito', evidence: [1] }] }],
      decisions: [{ text: 'Fechar o escopo', origin: 'dito', evidence: [1] }],
      tasks: [{ text: 'Fazer relatório', owner: 'Ana', deadline: 'sexta', deadline_quote: 'até sexta', origin: 'dito', evidence: [0] },
              { text: 'Ligar para o cliente', owner: 'Beto', origin: 'dito', evidence: [0] }],
      warnings: [] }) } }] }));
  });
  const base = await listen(fake);
  const provider = createOpenAIProvider({ apiKey: 'sk-teste', baseUrl: `${base}/v1`, transcriptionModel: 'm1', summaryModel: 'm2', language: 'pt' });
  const s = await boot(provider);
  try {
    const { id } = await (await upload(s.base)).json();
    const m = await wait(async () => { const x = await (await fetch(`${s.base}/api/meetings/${id}`)).json(); return x.status === 'ready' && x; });
    assert.equal(m.demo, false);
    assert.equal(m.transcript.segments.length, 2);
    assert.equal(m.result.tasks[0].owner, 'Ana');
    assert.equal(m.result.tasks[0].deadline, null, 'prazo cuja citação não está na transcrição é descartado');
    assert.equal(m.result.tasks[1].owner, null, 'responsável inventado é descartado');
    assert.ok(seen.every((r) => r.auth === 'Bearer sk-teste'));
    assert.match(seen[1].body, /\[1\] \(00:04\) Fechamos o escopo/);
    // a chave nunca é exposta ao navegador
    const cfg = JSON.stringify(await (await fetch(`${s.base}/api/config`)).json());
    assert.ok(!cfg.includes('sk-teste'));
  } finally { fake.close(); await s.close(); }
});

test('erro 401 do provedor gera mensagem orientando a verificar a chave', async () => {
  const fake = http.createServer((req, res) => { res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); res.end('{"error":{"message":"bad key"}}'); });
  const base = await listen(fake);
  const s = await boot(createOpenAIProvider({ apiKey: 'x', baseUrl: `${base}/v1`, transcriptionModel: 'm', summaryModel: 'm', language: 'pt' }));
  try {
    const { id } = await (await upload(s.base)).json();
    const m = await wait(async () => { const x = await (await fetch(`${s.base}/api/meetings/${id}`)).json(); return x.status === 'error' && x; });
    assert.match(m.error, /OPENAI_API_KEY/);
  } finally { fake.close(); await s.close(); }
});

test('reuniões interrompidas são retomadas após reinício', async () => {
  const s = await boot(demoProvider);
  try {
    const m = await s.app.store.create({ title: 'Pendente', filename: 'a.wav', mime: 'audio/wav', source: 'arquivo' });
    await fs.writeFile(s.app.store.audioPath(m.id), audio);
    await s.app.pipeline.recover();
    await wait(async () => (await s.app.store.get(m.id)).status === 'ready');
  } finally { await s.close(); }
});

test('momentos marcados durante a gravação são guardados e exportados', async () => {
  const s = await boot(demoProvider);
  try {
    const { id } = await (await upload(s.base, 'title=M&source=gravacao&marks=5.5,2,x')).json();
    const m = await wait(async () => { const x = await (await fetch(`${s.base}/api/meetings/${id}`)).json(); return x.status === 'ready' && x; });
    assert.deepEqual(m.marks, [2, 5.5]);
    const md = await (await fetch(`${s.base}/api/meetings/${id}/export.md`)).text();
    assert.match(md, /Momentos marcados/);
    assert.match(md, /\[00:02\]/);
  } finally { await s.close(); }
});
