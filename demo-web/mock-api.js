// API simulada em memória para a versão de demonstração hospedada (sem servidor).
// Usa o MESMO schema e o MESMO provedor "demo" do servidor. Nada é transcrito de verdade.
const store = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => structuredClone(x);
const listView = (m) => ({ id: m.id, title: m.title, status: m.status, error: m.error, failedStage: m.failedStage, demo: m.demo, source: m.source, durationSec: m.durationSec, createdAt: m.createdAt });

async function process(id) {
  const m = store.get(id);
  try {
    await sleep(2500);
    if (!store.has(id)) return;
    const segments = sanitizeSegments(await demoProvider.transcribe());
    m.transcript = { segments }; m.status = 'summarizing';
    await sleep(2500);
    if (!store.has(id)) return;
    const result = sanitizeResult(await demoProvider.summarize({ segments }), segments);
    result.warnings.unshift(DEMO_NOTICE);
    m.result = result; m.status = 'ready';
  } catch (e) { m.status = 'error'; m.error = e.message; m.failedStage = 'transcribing'; }
}

const api = {
  config: async () => ({ provider: 'demo', demo: true, auth: false, maxUploadMb: 25 }),
  me: async () => ({ local: true }),
  list: async () => [...store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(listView),
  get: async (id) => { if (!store.has(id)) throw new Error('Reunião não encontrada.'); return clone(store.get(id)); },
  remove: async (id) => { const m = store.get(id); if (m) URL.revokeObjectURL(m.audioUrl); store.delete(id); return null; },
  retry: async (id) => { const m = store.get(id); m.status = 'transcribing'; m.error = null; process(id); return listView(m); },
  patch: async (id, body) => {
    const m = store.get(id);
    if (typeof body.title === 'string' && body.title.trim()) m.title = body.title.trim().slice(0, 200);
    if (body.result) m.result = sanitizeEdit(body.result, m.result, m.transcript.segments.length);
    return clone(m);
  },
  audioUrl: async (id) => store.get(id)?.audioUrl || '',
  // O visualizador só permite salvar arquivos pela capacidade "downloads".
  downloadExport: async (id) => {
    try {
      const d = await window.claude?.use?.('downloads');
      if (!d) throw new Error('indisponível');
      await d.save({ filename: 'reuniao-demonstracao.md', data: toMarkdown(store.get(id)) });
    } catch (e) { announce(e?.code === 'declined' ? 'Exportação cancelada.' : 'Não foi possível salvar o arquivo neste visualizador.'); }
  },
  upload: async (blob, { title, filename, source, duration, marks }, onProgress) => {
    if (!/^(audio|video)\//.test(blob.type || 'audio/x')) throw new Error('Formato não suportado. Envie um arquivo de áudio.');
    for (let p = 0; p <= 1; p += 0.25) { onProgress(p); await sleep(120); }
    const id = crypto.randomUUID();
    const m = { id, title: title || 'Reunião de demonstração', filename, mime: blob.type, source, durationSec: duration ?? null, marks: marks || [],
      status: 'transcribing', error: null, failedStage: null, demo: true, createdAt: new Date().toISOString(), transcript: null, result: null,
      audioUrl: URL.createObjectURL(blob) };
    store.set(id, m);
    process(id);
    return listView(m);
  },
};
