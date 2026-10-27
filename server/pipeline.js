// Processamento assíncrono: fila sequencial; cada reunião passa por transcrição → resumo.
import { sanitizeResult, sanitizeSegments } from './schema.js';
import { DEMO_NOTICE } from './ai/demo.js';

export class Pipeline {
  constructor({ store, provider, quota = null, log = console }) {
    this.store = store;
    this.quota = quota; // opcional: débito de minutos (modo serviço)
    this.provider = provider;
    this.log = log;
    this.queue = [];
    this.running = false;
    this.idle = Promise.resolve();
  }

  enqueue(id) {
    if (!this.queue.includes(id)) this.queue.push(id);
    if (!this.running) this.idle = this.#drain();
    return this.idle;
  }

  /** Retoma reuniões interrompidas por reinício do servidor. */
  async recover() {
    for (const m of await this.store.list()) {
      if (m.status === 'transcribing' || m.status === 'summarizing') this.enqueue(m.id);
    }
  }

  async #drain() {
    this.running = true;
    while (this.queue.length) {
      const id = this.queue.shift();
      try { await this.#process(id); } catch (e) { this.log.error(`[pipeline] ${id}:`, e); }
    }
    this.running = false;
  }

  async #process(id) {
    let m = await this.store.get(id);
    if (!m) return; // excluída enquanto aguardava na fila
    const stage = { current: 'transcribing' };
    try {
      m.demo = this.provider.demo;
      if (!m.transcript) {
        m.status = 'transcribing'; m.error = null; m.failedStage = null;
        await this.store.save(m);
        const raw = await this.store.withAudioFile(id, (audioPath) =>
          this.provider.transcribe({ audioPath, mime: m.mime, filename: m.filename }));
        const segments = sanitizeSegments(raw);
        if (!segments.length) {
          throw new Error('Nenhuma fala foi reconhecida no áudio. Ele pode estar vazio, mudo ou inaudível.');
        }
        if (!(await this.#stillExists(id))) return;
        m.transcript = { segments };
        await this.#charge(m, segments);
      }

      stage.current = 'summarizing';
      m.status = 'summarizing';
      await this.store.save(m);
      const raw = await this.provider.summarize({ segments: m.transcript.segments });
      const result = sanitizeResult(raw, m.transcript.segments);
      if (m.demo && !result.warnings.includes(DEMO_NOTICE)) result.warnings.unshift(DEMO_NOTICE);
      if (!(await this.#stillExists(id))) return;
      m.result = result;
      m.status = 'ready';
      await this.store.save(m);
    } catch (e) {
      this.log.error(`[pipeline] falha em ${id} (${stage.current}):`, e.message);
      if (!(await this.#stillExists(id))) return;
      m = (await this.store.get(id)) || m;
      m.status = 'error';
      m.failedStage = stage.current;
      m.error = e.message || 'Erro desconhecido.';
      await this.store.save(m);
    }
  }

  /** Debita os minutos do áudio transcrito. Falha de cobrança é registrada, não derruba o processamento. */
  async #charge(m, segments) {
    if (!this.quota || !m.userId) return;
    const seconds = Math.max(segments.at(-1)?.end ?? 0, m.durationSec ?? 0);
    try { await this.quota.consume(m.userId, seconds, m.id); }
    catch (e) { this.log.error(`[quota] falha ao debitar ${m.id}:`, e.detail || e.message); }
  }

  async #stillExists(id) {
    return Boolean(await this.store.get(id));
  }
}
