// Armazenamento das reuniões no Supabase. Mesma interface do Store de arquivos (server/store.js).
// Com { token } as consultas passam pelo RLS do usuário; com 'service' (pipeline) valem para todos.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

const SUMMARY_COLS = 'id,user_id,title,status,error,failed_stage,demo,source,duration_sec,created_at,updated_at';

const fromRow = (r) => ({
  id: r.id, userId: r.user_id, title: r.title, filename: r.filename, mime: r.mime, source: r.source,
  durationSec: r.duration_sec == null ? null : Number(r.duration_sec), marks: r.marks ?? [],
  status: r.status, error: r.error, failedStage: r.failed_stage, demo: r.demo,
  transcript: r.transcript ?? null, result: r.result ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
});

export class SupabaseStore {
  constructor(sb, auth = 'service') { this.sb = sb; this.auth = auth; }

  forUser(token) { return new SupabaseStore(this.sb, { token }); }

  async create({ title, filename, mime, source, durationSec, marks = [] }) {
    const rows = await this.sb.rest(this.auth, 'POST', 'meetings', {
      prefer: 'return=representation',
      body: { title, filename, mime, source, duration_sec: durationSec ?? null, marks, status: 'transcribing' },
    });
    return fromRow(rows[0]);
  }

  async save(m) {
    const rows = await this.sb.rest(this.auth, 'PATCH', `meetings?id=eq.${m.id}`, {
      prefer: 'return=representation',
      body: { title: m.title, status: m.status, error: m.error, failed_stage: m.failedStage, demo: m.demo, transcript: m.transcript, result: m.result, marks: m.marks },
    });
    if (!rows?.length) throw new Error('Reunião não encontrada ao salvar.');
    return m;
  }

  async get(id) {
    const rows = await this.sb.rest(this.auth, 'GET', `meetings?id=eq.${id}&select=*`);
    return rows?.[0] ? fromRow(rows[0]) : null;
  }

  /** Lista leve (sem transcrição/resultado). */
  async list({ statuses } = {}) {
    const filter = statuses ? `&status=in.(${statuses.join(',')})` : '';
    const rows = await this.sb.rest(this.auth, 'GET', `meetings?select=${SUMMARY_COLS}&order=created_at.desc${filter}`);
    return rows.map(fromRow);
  }

  #path(m) { return `${m.userId}/${m.id}`; }

  async putAudio(id, buffer, mime) {
    const m = await this.get(id);
    if (!m) throw new Error('Reunião não encontrada.');
    await this.sb.storage.put(this.auth, this.#path(m), buffer, mime || m.mime);
    await this.sb.rest(this.auth, 'PATCH', `meetings?id=eq.${id}`, { body: { audio_path: this.#path(m) } });
  }

  async audio(id, rangeHeader, mime) {
    const m = await this.get(id);
    if (!m) return null;
    const res = await this.sb.storage.get(this.auth, this.#path(m), rangeHeader);
    if (!res.ok) { if (res.status < 500) return null; throw new Error('Falha ao ler o áudio.'); }
    const headers = { 'Content-Type': mime || m.mime || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    for (const h of ['content-range', 'content-length']) if (res.headers.get(h)) headers[h] = res.headers.get(h);
    return { status: res.status === 206 ? 206 : 200, headers, stream: Readable.fromWeb(res.body) };
  }

  async withAudioFile(id, fn) {
    const m = await this.get(id);
    if (!m) throw new Error('Reunião não encontrada.');
    const res = await this.sb.storage.get(this.auth, this.#path(m));
    if (!res.ok) throw new Error('Não foi possível baixar o áudio para processamento.');
    const file = path.join(os.tmpdir(), `confere-${crypto.randomUUID()}`);
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
    try { return await fn(file); } finally { await fs.rm(file, { force: true }); }
  }

  /** Apaga a linha (RLS) e depois o áudio. Se o áudio falhar, registra e segue (a linha já sumiu). */
  async remove(id) {
    const m = await this.get(id);
    if (!m) return;
    await this.sb.rest(this.auth, 'DELETE', `meetings?id=eq.${id}`);
    try { await this.sb.storage.remove(this.auth, this.#path(m)); }
    catch (e) { console.error('[storage] áudio órfão:', this.#path(m), e.detail || e.message); }
  }
}
