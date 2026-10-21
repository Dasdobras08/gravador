import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeResult, sanitizeSegments, sanitizeEdit } from '../server/schema.js';

const segs = sanitizeSegments([
  { start: 0, end: 5, text: 'Maria vai enviar a proposta até sexta-feira.' },
  { start: 5, end: 9, text: 'Combinado, vamos fechar o orçamento.' },
]);

test('mantém responsável e prazo somente quando aparecem na transcrição', () => {
  const r = sanitizeResult({
    tasks: [
      { text: 'Enviar proposta', owner: 'Maria', deadline: 'sexta', deadline_quote: 'até sexta-feira', evidence: [0] },
      { text: 'Revisar contrato', owner: 'Carlos', deadline: 'amanhã', deadline_quote: 'amanhã cedo', evidence: [1] },
    ],
  }, segs);
  assert.equal(r.tasks[0].owner, 'Maria');
  assert.equal(r.tasks[0].deadline, 'sexta');
  assert.equal(r.tasks[1].owner, null, 'responsável inventado deve ser descartado');
  assert.equal(r.tasks[1].deadline, null, 'prazo sem citação verificável deve ser descartado');
});

test('prazo sem citação é descartado', () => {
  const r = sanitizeResult({ tasks: [{ text: 'x', deadline: 'sexta', evidence: [0] }] }, segs);
  assert.equal(r.tasks[0].deadline, null);
});

test('evidências inválidas são removidas e item "dito" sem apoio fica não verificado', () => {
  const r = sanitizeResult({ decisions: [
    { text: 'Fechar orçamento', evidence: [1, 99, -1, 'a'] },
    { text: 'Inventado', evidence: [42] },
    { text: 'Sugestão', origin: 'sugestao_ia' },
  ] }, segs);
  assert.deepEqual(r.decisions[0].evidence, [1]);
  assert.equal(r.decisions[0].unverified, false);
  assert.equal(r.decisions[1].unverified, true);
  assert.equal(r.decisions[2].origin, 'sugestao_ia');
  assert.equal(r.decisions[2].unverified, false);
});

test('origem desconhecida vira "dito" (nunca promove sugestão a fato por engano)', () => {
  const r = sanitizeResult({ decisions: [{ text: 'a', origin: 'outra', evidence: [] }] }, segs);
  assert.equal(r.decisions[0].origin, 'dito');
  assert.equal(r.decisions[0].unverified, true);
});

test('saída malformada não quebra', () => {
  const r = sanitizeResult(null, segs);
  assert.deepEqual([r.topics, r.decisions, r.tasks], [[], [], []]);
});

test('segmentos inválidos são ignorados e reindexados', () => {
  const s = sanitizeSegments([{ start: 'x', text: 'a' }, { start: 1, text: '' }, { start: 2, end: 3, text: 'ok' }]);
  assert.equal(s.length, 1);
  assert.equal(s[0].i, 0);
});

test('edição manual preserva evidências e marca itens editados/novos', () => {
  const prev = sanitizeResult({ decisions: [{ text: 'Fechar orçamento', evidence: [1] }],
    tasks: [{ text: 'Enviar proposta', owner: 'Maria', evidence: [0] }] }, segs);
  const edited = sanitizeEdit({
    decisions: [{ ...prev.decisions[0], text: 'Fechar orçamento hoje', evidence: [0, 1] }, { id: '', text: 'Nova' }],
    tasks: [{ ...prev.tasks[0], owner: '' }],
  }, prev, segs.length);
  assert.deepEqual(edited.decisions[0].evidence, [1], 'o cliente não pode forjar evidências');
  assert.equal(edited.decisions[0].edited, true);
  assert.equal(edited.decisions[1].origin, 'manual');
  assert.equal(edited.tasks[0].owner, null);
  assert.equal(edited.tasks[0].edited, true);
});
