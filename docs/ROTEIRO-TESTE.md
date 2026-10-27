# Roteiro de teste com a API real e dispositivos móveis

## Parte 1 — Texto para ler em voz alta (cerca de 40 s)

Grave-se lendo, com calma e voz natural:

> Bom dia a todos. Vamos revisar o lançamento do novo portal.
> Decidimos adiar o lançamento para a semana de quinze de março.
> A Marina vai enviar o relatório de testes até sexta-feira.
> Alguém precisa atualizar a documentação, mas ainda não definimos quem.
> Ficou em aberto se vamos contratar mais um desenvolvedor. Vamos discutir isso na próxima reunião.
>
> *(murmure ou fale baixo, quase inaudível:)* … o orçamento fica em … algum valor …

## Resultado esperado

| Item | Esperado | Reprova se… |
|---|---|---|
| Decisão | "Adiar o lançamento para a semana de 15 de março", com ▶ no 2º trecho | não aparecer, ou sem ▶ |
| Tarefa do relatório | Responsável **Marina**, prazo **sexta-feira**, com ▶ | responsável/prazo ausentes ou trocados |
| Tarefa da documentação | Responsável **não especificado**, prazo **não especificado** | aparecer um nome ou data |
| Contratar desenvolvedor | **Não** é decisão (no máximo um tópico "em aberto") | listado em "Decisões" |
| Trecho murmurado | Aviso de áudio ambíguo/inaudível, ou nenhum item inventado | surgir um valor de orçamento |
| ▶ | Toca o áudio no momento do trecho citado | tocar em outro ponto |
| Sugestões | Qualquer item fora da fala vem com a marca "Sugestão da IA" | sugestão sem a marca |

## Parte 2 — API real

1. `.env` com `OPENAI_API_KEY`; `npm start`; o selo no topo deve dizer **IA: openai**.
2. Envie o áudio (gravado no navegador ou como arquivo) e confira a tabela acima.
3. Falhas: chave inválida → mensagem sobre `OPENAI_API_KEY`; arquivo de texto renomeado para `.mp3` → erro claro, sem resumo inventado; áudio mudo → "Nenhuma fala foi reconhecida".
4. Teste automatizado equivalente: `OPENAI_API_KEY=sk-... npm test` (o teste `real-api` gera o áudio acima por síntese de voz).
5. Uma reunião real longa (até 25 MB): avalie se o resumo é útil e se algum ponto não tem apoio no trecho citado.

## Parte 3 — iOS e Android

O microfone exige HTTPS ou `localhost`.

- **Túnel:** `cloudflared tunnel --url http://localhost:3000` (ou `ngrok http 3000`) e abra a URL `https://…` no celular. **O app não tem login**: use só dados de teste e feche o túnel ao terminar.
- **Android com cabo:** `chrome://inspect` no computador, encaminhe a porta 3000 e abra `localhost:3000` no celular.

| # | Cenário | Esperado |
|---|---|---|
| 1 | Gravar 1 min, tela ligada | grava, envia, processa |
| 2 | Gravar com a tela bloqueada por 1 min | anote se há lacuna no áudio (limitação conhecida) |
| 3 | Gravar e trocar de app, voltar | aviso de aba em segundo plano |
| 4 | Negar permissão do microfone | mensagem clara e opção de enviar arquivo |
| 5 | Ligação durante a gravação | trecho capturado pode ser enviado, ou erro claro |
| 6 | Enviar arquivo da galeria/Arquivos | envia e processa |
| 7 | iOS Safari: formato gravado (`audio/mp4`) | a API aceita; se der erro, registre a mensagem |
| 8 | Tocar o áudio e os ▶ no resultado | reproduz e busca o ponto certo |
| 9 | Excluir a reunião | some da lista; pasta apagada em `data/meetings/` |

## Parte 4 — Acessibilidade e navegadores

- Só com teclado (Tab, Enter, Espaço, Esc nos diálogos): iniciar gravação, enviar arquivo, editar e excluir.
- VoiceOver (Mac/iOS) ou TalkBack (Android): o estado "GRAVANDO/PAUSADA" e o status do processamento devem ser anunciados.
- Firefox e Safari desktop: gravação, pausa e barra de progresso.

Registre o que falhar com: dispositivo, navegador, passo e mensagem exibida.
