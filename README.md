# Confere

Grave (ou envie) o áudio de uma reunião e revise depois um resumo com decisões e tarefas **ligadas aos trechos da conversa**, para você poder conferir tudo na gravação.

## Executar

Requer Node 20+ (sem dependências npm).

```bash
cp .env.example .env     # opcional: preencha OPENAI_API_KEY para processamento real
npm start                # http://127.0.0.1:3000
npm test
```

Sem `OPENAI_API_KEY` o app roda em **modo demonstração**: o áudio é guardado, mas a transcrição e o resumo são um exemplo fixo, identificado como tal em toda a interface e na exportação.

## Configuração (variáveis de ambiente)

| Variável | Padrão | Descrição |
|---|---|---|
| `OPENAI_API_KEY` | – | Ativa transcrição/resumo reais (fica só no servidor) |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Qualquer API compatível |
| `TRANSCRIPTION_MODEL` / `SUMMARY_MODEL` | `whisper-1` / `gpt-4o-mini` | Modelos |
| `TRANSCRIPTION_LANGUAGE` | `pt` | Idioma |
| `AI_PROVIDER` | auto | `openai` ou `demo` |
| `MAX_UPLOAD_MB` | `25` | Limite de envio (25 MB é o limite da API de transcrição) |
| `PORT`, `HOST`, `DATA_DIR` | `3000`, `127.0.0.1`, `./data` | Servidor e armazenamento |

## Arquitetura

- `server/app.js` – API HTTP e arquivos estáticos; `server/store.js` – persistência em `data/meetings/<id>/` (áudio, transcrição, resultados; nada é servido publicamente).
- `server/pipeline.js` – fila assíncrona: transcrevendo → gerando resumo → pronta/erro; retoma pendências ao reiniciar; reprocessamento após falha.
- `server/ai/` – provedores substituíveis (`transcribe()` + `summarize()`): `openai.js`, `demo.js`. Para trocar de provedor, implemente a mesma interface e registre em `ai/index.js`.
- `server/schema.js` – formato único dos resultados e **validação no servidor**: responsável e prazo só são mantidos se estiverem literalmente na transcrição; evidências inexistentes são descartadas; itens "ditos" sem trecho ficam marcados como não verificados; sugestões da IA têm origem própria.
- `public/` – interface em pt-BR (`recorder.js` isolado da UI).

## O que funciona hoje (verificado)

Novidades: tela de gravação com relógio grande, botão "Marcar momento", busca na transcrição, filtro "só o que precisa de conferência" e apresentação na primeira visita.

Roteiro de testes manuais (API real, iOS/Android, acessibilidade): `docs/ROTEIRO-TESTE.md`. Teste automatizado com a API real: `OPENAI_API_KEY=sk-... npm test` (ignorado sem chave).

Lista/estados, gravação no Chromium (microfone falso), pausa/retomada, envio de arquivo com progresso, processamento, erro e reprocessamento, edição, exportação Markdown, impressão, exclusão completa, Range de áudio, validações. O caminho de IA real foi testado **apenas contra um servidor OpenAI simulado**; não foi exercitado com a API real nem com áudio de reunião real.

## Limitações conhecidas

- A gravação depende de HTTPS ou `localhost`, de permissão do microfone e de a aba permanecer ativa. Navegadores (especialmente iOS/Android) podem suspender a captura com a tela bloqueada ou a aba em segundo plano; o app avisa quando a aba vai para segundo plano, mas não garante continuidade. Se o microfone cair, o trecho já capturado pode ser enviado.
- Grava apenas o **seu microfone**, não o áudio de outros participantes de chamadas online (grave por outro meio e envie o arquivo).
- Arquivos acima de `MAX_UPLOAD_MB` são recusados (sem divisão automática). Sem identificação de falantes.
- Sem login: pensado para uso local; para expor na rede, coloque atrás de autenticação/HTTPS.
- Resumos de IA podem errar: confira pelos trechos (▶).
