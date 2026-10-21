// Provedor para APIs compatíveis com a OpenAI (transcrição + chat). A chave fica só no servidor.
// Para trocar de provedor, implemente { name, demo, transcribe(), summarize() } e registre em ai/index.js.
import fs from 'node:fs/promises';

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const SYSTEM_PROMPT = `Você analisa a transcrição de uma reunião de trabalho em português do Brasil e produz um resumo FIEL.
Cada linha da transcrição tem o formato "[índice] (mm:ss) texto".

REGRAS OBRIGATÓRIAS
- Use SOMENTE o que está na transcrição. Não invente falas, decisões, nomes, responsáveis ou prazos.
- "evidence" é a lista de índices das linhas que sustentam o item. Use apenas índices existentes.
- Decisão = algo que os participantes efetivamente decidiram/acordaram. Se ficou em aberto, NÃO é decisão.
- Tarefa só com "owner" se uma pessoa foi explicitamente designada ou se comprometeu na fala; caso contrário owner = null.
- "deadline" só se um prazo foi dito; copie em "deadline_quote" o trecho EXATO da transcrição que o contém. Senão deadline = null e deadline_quote = null.
- origin = "dito" para o que foi dito na reunião. Se quiser propor algo que NÃO foi dito, use origin = "sugestao_ia" (sem evidence). Use com moderação.
- Se o áudio parece incompleto, truncado, inaudível ou ambíguo, descreva isso em "warnings" em vez de preencher lacunas.
- Não produza números, percentuais ou estatísticas que não estejam explícitos na fala.

Responda APENAS com JSON neste formato:
{"overview": string,
 "topics": [{"title": string, "points": [{"text": string, "origin": "dito"|"sugestao_ia", "evidence": [number]}]}],
 "decisions": [{"text": string, "origin": "dito"|"sugestao_ia", "evidence": [number]}],
 "tasks": [{"text": string, "owner": string|null, "deadline": string|null, "deadline_quote": string|null, "origin": "dito"|"sugestao_ia", "evidence": [number]}],
 "warnings": [string]}`;

async function api(url, init, what) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10 * 60 * 1000) });
  } catch (e) {
    throw new Error(`Não foi possível contatar o serviço de ${what} (${e.name === 'TimeoutError' ? 'tempo esgotado' : e.message}).`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* corpo não-JSON */ }
    const hint = res.status === 401 ? ' Verifique a OPENAI_API_KEY.' : res.status === 413 ? ' O arquivo excede o limite do serviço.' : '';
    throw new Error(`O serviço de ${what} respondeu ${res.status}.${hint} ${detail}`.trim());
  }
  return res.json();
}

export function createOpenAIProvider(cfg) {
  const headers = { Authorization: `Bearer ${cfg.apiKey}` };
  return {
    name: 'openai',
    demo: false,

    async transcribe({ audioPath, mime, filename }) {
      const buf = await fs.readFile(audioPath);
      const form = new FormData();
      form.append('file', new Blob([buf], { type: mime || 'application/octet-stream' }), filename || 'audio');
      form.append('model', cfg.transcriptionModel);
      form.append('response_format', 'verbose_json');
      if (cfg.language) form.append('language', cfg.language);
      const data = await api(`${cfg.baseUrl}/audio/transcriptions`, { method: 'POST', headers, body: form }, 'transcrição');
      if (Array.isArray(data.segments) && data.segments.length) {
        return data.segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));
      }
      if (data.text?.trim()) return [{ start: 0, end: data.duration ?? 0, text: data.text }];
      return [];
    },

    async summarize({ segments }) {
      const transcript = segments.map((s) => `[${s.i}] (${fmt(s.start)}) ${s.text}`).join('\n');
      const data = await api(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.summaryModel,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Transcrição:\n${transcript}` },
          ],
        }),
      }, 'resumo');
      const content = data?.choices?.[0]?.message?.content;
      try {
        return JSON.parse(content);
      } catch {
        throw new Error('O serviço de resumo devolveu uma resposta que não pôde ser lida. Tente reprocessar.');
      }
    },
  };
}
