// Persistência em arquivos: data/meetings/<id>/{meeting.json,audio.bin}.
// Nada aqui é servido estaticamente; o áudio só sai pela rota /api/meetings/:id/audio.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ID_RE = /^[0-9a-f-]{36}$/;

export class Store {
  constructor(dataDir) {
    this.root = path.join(dataDir, 'meetings');
  }

  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  dir(id) {
    if (!ID_RE.test(id)) throw Object.assign(new Error('Identificador inválido.'), { status: 400 });
    return path.join(this.root, id);
  }

  audioPath(id) {
    return path.join(this.dir(id), 'audio.bin');
  }

  forUser() { return this; } // modo local: um único usuário

  async create({ title, filename, mime, source, durationSec, marks = [] }) {
    const id = crypto.randomUUID();
    await fs.mkdir(this.dir(id), { recursive: true, mode: 0o700 });
    const now = new Date().toISOString();
    const meeting = {
      id, title, filename, mime, source, // source: 'gravacao' | 'arquivo'
      durationSec: durationSec ?? null,
      marks, // momentos marcados pelo usuário durante a gravação (segundos)
      status: 'transcribing', // transcribing | summarizing | ready | error
      error: null, failedStage: null,
      demo: false,
      createdAt: now, updatedAt: now,
      transcript: null, // { segments: [{i,start,end,text}] }
      result: null,
    };
    await this.save(meeting);
    return meeting;
  }

  async save(meeting) {
    meeting.updatedAt = new Date().toISOString();
    const file = path.join(this.dir(meeting.id), 'meeting.json');
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(meeting, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
    return meeting;
  }

  async get(id) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir(id), 'meeting.json'), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async list({ statuses } = {}) {
    const ids = await fs.readdir(this.root).catch(() => []);
    const all = [];
    for (const id of ids) {
      if (!ID_RE.test(id)) continue;
      const m = await this.get(id).catch(() => null);
      if (m) all.push(m);
    }
    const out = statuses ? all.filter((m) => statuses.includes(m.status)) : all;
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async putAudio(id, buffer) {
    await fs.writeFile(this.audioPath(id), buffer, { mode: 0o600 });
  }

  /** Resposta de áudio com suporte a Range: { status, headers, stream } ou null se não existir. */
  async audio(id, rangeHeader, mime) {
    const file = this.audioPath(id);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) return null;
    const headers = { 'Content-Type': mime || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      const end = Math.min(range[1] && range[2] ? Number(range[2]) : stat.size - 1, stat.size - 1);
      if (start > end) return { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` }, stream: null };
      return { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 }, stream: createReadStream(file, { start, end }) };
    }
    return { status: 200, headers: { ...headers, 'Content-Length': stat.size }, stream: createReadStream(file) };
  }

  /** Dá ao `fn` um caminho local para o áudio (aqui já é local). */
  async withAudioFile(id, fn) {
    return fn(this.audioPath(id));
  }

  /** Remove reunião, áudio, transcrição e resultados (tudo vive na mesma pasta). */
  async remove(id) {
    await fs.rm(this.dir(id), { recursive: true, force: true });
  }
}
