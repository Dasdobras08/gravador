// Formato único dos resultados + validação defensiva da saída da IA.
// Regras de fidelidade aplicadas aqui, no servidor, e não apenas no prompt:
//  - responsável só é mantido se o nome aparece literalmente na transcrição;
//  - prazo só é mantido se a citação do prazo aparece literalmente na transcrição;
//  - itens "dito" sem trecho de apoio válido ficam marcados como não verificados;
//  - o que a IA propõe por conta própria é sempre origem "sugestao_ia".

import crypto from 'node:crypto';

export const ORIGINS = ['dito', 'sugestao_ia'];

const norm = (s) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const str = (v, max = 1000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const uid = () => crypto.randomUUID().slice(0, 8);

function cleanEvidence(raw, segCount) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const n of raw) {
    const i = Number(n);
    if (Number.isInteger(i) && i >= 0 && i < segCount && !out.includes(i)) out.push(i);
  }
  return out.sort((a, b) => a - b).slice(0, 6);
}

function baseItem(raw, segCount) {
  const origin = ORIGINS.includes(raw?.origin) ? raw.origin : 'dito';
  const evidence = cleanEvidence(raw?.evidence, segCount);
  return {
    id: uid(),
    text: str(raw?.text),
    origin,
    evidence,
    // "dito" sem trecho de apoio não pode ser apresentado como verificado
    unverified: origin === 'dito' && evidence.length === 0,
    edited: false,
  };
}

export function sanitizeResult(raw, segments) {
  const n = segments.length;
  const haystack = norm(segments.map((s) => s.text).join(' '));
  const inTranscript = (needle) => {
    const x = norm(needle);
    return x.length >= 2 && haystack.includes(x);
  };

  const topics = (Array.isArray(raw?.topics) ? raw.topics : [])
    .map((t) => ({
      id: uid(),
      title: str(t?.title, 200),
      points: (Array.isArray(t?.points) ? t.points : []).map((p) => baseItem(p, n)).filter((p) => p.text),
    }))
    .filter((t) => t.title || t.points.length);

  const decisions = (Array.isArray(raw?.decisions) ? raw.decisions : [])
    .map((d) => baseItem(d, n))
    .filter((d) => d.text);

  const tasks = (Array.isArray(raw?.tasks) ? raw.tasks : [])
    .map((t) => {
      const item = baseItem(t, n);
      const owner = str(t?.owner, 120);
      const deadlineQuote = str(t?.deadline_quote, 300);
      const deadline = str(t?.deadline, 120);
      return {
        ...item,
        owner: owner && inTranscript(owner) ? owner : null,
        deadline: deadline && deadlineQuote && inTranscript(deadlineQuote) ? deadline : null,
        done: false,
      };
    })
    .filter((t) => t.text);

  return {
    overview: str(raw?.overview, 2000),
    topics,
    decisions,
    tasks,
    warnings: (Array.isArray(raw?.warnings) ? raw.warnings : []).map((w) => str(w, 400)).filter(Boolean).slice(0, 10),
  };
}

/** Valida edições manuais vindas do navegador; itens editados ficam marcados como tal. */
export function sanitizeEdit(input, previous, segCount) {
  const prevItems = new Map();
  for (const t of previous.topics) for (const p of t.points) prevItems.set(p.id, p);
  for (const d of previous.decisions) prevItems.set(d.id, d);
  for (const t of previous.tasks) prevItems.set(t.id, t);

  const item = (raw) => {
    const prev = prevItems.get(raw?.id);
    const text = str(raw?.text);
    // item novo criado pelo usuário recebe origem "manual" (nem dito, nem sugestão da IA)
    const evidence = prev ? prev.evidence : [];
    return {
      id: prev ? prev.id : uid(),
      text,
      origin: prev ? prev.origin : 'manual',
      evidence: cleanEvidence(evidence, segCount),
      unverified: prev ? prev.unverified : false,
      edited: prev ? prev.edited || text !== prev.text : true,
      manual: !prev,
    };
  };

  return {
    overview: str(input?.overview, 2000),
    topics: (Array.isArray(input?.topics) ? input.topics : [])
      .map((t) => ({ id: str(t?.id, 20) || uid(), title: str(t?.title, 200), points: (Array.isArray(t?.points) ? t.points : []).map(item).filter((p) => p.text) }))
      .filter((t) => t.title || t.points.length),
    decisions: (Array.isArray(input?.decisions) ? input.decisions : []).map(item).filter((d) => d.text),
    tasks: (Array.isArray(input?.tasks) ? input.tasks : [])
      .map((t) => {
        const prev = prevItems.get(t?.id);
        return {
          ...item(t),
          owner: str(t?.owner, 120) || null,
          deadline: str(t?.deadline, 120) || null,
          done: Boolean(t?.done),
          edited: !prev || prev.edited || t?.text !== prev.text || (str(t?.owner, 120) || null) !== prev.owner || (str(t?.deadline, 120) || null) !== prev.deadline,
        };
      })
      .filter((t) => t.text),
    warnings: previous.warnings,
  };
}

export function sanitizeSegments(raw) {
  const out = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const text = str(s?.text, 5000);
    const start = Number(s?.start);
    if (!text || !Number.isFinite(start)) continue;
    const end = Number.isFinite(Number(s?.end)) ? Number(s.end) : start;
    out.push({ i: out.length, start: Math.max(0, start), end: Math.max(start, end), text });
  }
  return out;
}
