// Teste de integração com a API REAL. Só roda com OPENAI_API_KEY definida; caso contrário é ignorado.
//   OPENAI_API_KEY=sk-... npm test
// Gera um áudio de roteiro conhecido com a própria API (síntese de voz), transcreve, resume e confere
// as regras de fidelidade. Custo: centavos. As verificações dependem de um modelo, então podem variar:
// uma falha aqui pede investigação (veja a saída), não necessariamente indica bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createOpenAIProvider } from '../server/ai/openai.js';
import { sanitizeResult, sanitizeSegments } from '../server/schema.js';

const cfg = loadConfig();
const skip = cfg.openai.apiKey ? false : 'defina OPENAI_API_KEY para rodar o teste com a API real';

const SCRIPT = [
  'Bom dia a todos. Vamos revisar o lançamento do novo portal.',
  'Decidimos adiar o lançamento para a semana de quinze de março.',
  'A Marina vai enviar o relatório de testes até sexta-feira.',
  'Alguém precisa atualizar a documentação, mas ainda não definimos quem.',
  'Ficou em aberto se vamos contratar mais um desenvolvedor. Vamos discutir isso na próxima reunião.',
].join(' ');

async function synthesize() {
  const res = await fetch(`${cfg.openai.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.openai.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.TTS_MODEL || 'tts-1', voice: 'alloy', input: SCRIPT, response_format: 'mp3' }),
  });
  assert.equal(res.status, 200, `síntese de voz falhou (${res.status}); defina TTS_MODEL se necessário`);
  return Buffer.from(await res.arrayBuffer());
}

test('API real: transcrição e resumo respeitam as regras de fidelidade', { skip, timeout: 180000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gravador-real-'));
  try {
    const file = path.join(dir, 'roteiro.mp3');
    await fs.writeFile(file, await synthesize());
    const provider = createOpenAIProvider(cfg.openai);

    const segments = sanitizeSegments(await provider.transcribe({ audioPath: file, mime: 'audio/mpeg', filename: 'roteiro.mp3' }));
    console.log('transcrição:', segments.map((s) => `[${s.i}] ${s.start.toFixed(1)}s ${s.text}`).join('\n'));
    assert.ok(segments.length >= 1, 'deve haver ao menos um segmento');
    assert.match(segments.map((s) => s.text).join(' '), /marina/i, 'a transcrição deve conter "Marina"');

    const result = sanitizeResult(await provider.summarize({ segments }), segments);
    console.log('resultado:', JSON.stringify(result, null, 2));

    const marina = result.tasks.find((t) => /relat[óo]rio/i.test(t.text));
    assert.ok(marina, 'deve haver a tarefa do relatório');
    assert.match(marina.owner ?? '', /marina/i, 'responsável explícito deve ser mantido');
    assert.ok(marina.deadline, 'prazo explícito deve ser mantido');

    const docs = result.tasks.find((t) => /documenta/i.test(t.text));
    if (docs) {
      assert.equal(docs.owner, null, 'responsável não definido deve ser "não especificado"');
      assert.equal(docs.deadline, null);
    }

    assert.ok(result.decisions.some((d) => /adi/i.test(d.text)), 'deve haver a decisão de adiar');
    assert.ok(!result.decisions.some((d) => /contrat/i.test(d.text)), 'assunto em aberto não pode virar decisão');
    for (const d of result.decisions) {
      if (d.origin === 'dito') assert.ok(!d.unverified, `decisão sem trecho de apoio: ${d.text}`);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
