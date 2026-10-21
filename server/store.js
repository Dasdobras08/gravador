// Persistência em arquivos: data/meetings/<id>/{meeting.json,audio.bin}.
// Nada aqui é servido estaticamente; o áudio só sai pela rota /api/meetings/:id/audio.
import fs from 'node:fs/promises';
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

  async create({ title, filename, mime, source, durationSec }) {
    const id = crypto.randomUUID();
    await fs.mkdir(this.dir(id), { recursive: true, mode: 0o700 });
    const now = new Date().toISOString();
    const meeting = {
      id, title, filename, mime, source, // source: 'gravacao' | 'arquivo'
      durationSec: durationSec ?? null,
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

  async list() {
    const ids = await fs.readdir(this.root).catch(() => []);
    const all = [];
    for (const id of ids) {
      if (!ID_RE.test(id)) continue;
      const m = await this.get(id).catch(() => null);
      if (m) all.push(m);
    }
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Remove reunião, áudio, transcrição e resultados (tudo vive na mesma pasta). */
  async remove(id) {
    await fs.rm(this.dir(id), { recursive: true, force: true });
  }
}
