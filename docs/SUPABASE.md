# Confere no Supabase (contas, planos e saldo de minutos)

Esta é a **Etapa 1**: cadastro/login, dados e áudios por usuário, teste gratuito e saldo de minutos. A cobrança (Etapa 3) e os textos legais (Etapa 4) ainda não existem.

## Como funciona

```
Navegador ──► Servidor Node (este repositório) ──► Supabase (Auth, Postgres, Storage)
                  │                                      ▲
                  └──► OpenAI (transcrição e resumo)     │ chave de serviço: só no pipeline e no saldo
```

- O navegador **só fala com o servidor Node** (`/api/...`). Nenhuma chave do Supabase vai para o navegador.
- Rotas do usuário usam o **token dele**: o RLS do Postgres e as políticas do Storage valem. É a barreira real entre contas.
- A **chave de serviço** (que ignora o RLS) é usada apenas para: processar em segundo plano, debitar minutos e conceder minutos extras. Nunca para ler dados a pedido de um usuário.
- Sem `SUPABASE_URL`, o app continua no **modo local** (um usuário, arquivos em `data/`).

## Criar o projeto (uma vez)

1. Em supabase.com, crie um projeto e anote a **Project URL**.
2. *Project Settings → API*: copie a chave **anon** (pública) e a **service_role** (segredo).
3. *SQL Editor*: cole e execute `supabase/migrations/0001_base.sql`.
4. *Authentication → Providers → Email*: deixe habilitado. Recomendo manter **"Confirm email"** ligado (evita contas com e-mails falsos).
5. *Authentication → URL Configuration*: defina o **Site URL** com o endereço onde o app vai rodar (para o link do e-mail de confirmação e de recuperação de senha).
6. *Storage*: confira que existe o bucket **audio**, privado (a migração o cria).
7. Preencha o `.env` (veja `.env.example`) e rode `npm start`. Abra o app: deve aparecer a tela **Entrar**.

> O e-mail embutido do Supabase tem limites baixos de envio; antes de lançar, configure um provedor SMTP próprio (*Authentication → SMTP*).

## Planos e saldo

Tabela `plans` (editável no Supabase):

| plano | minutos | observação |
|---|---|---|
| `teste` | 20 | 7 dias, sem cartão (definido por você) |
| `intermediario` | 300 | **valor provisório** |
| `premium` | 1200 | **valor provisório** |

Preços (`price_cents`) estão vazios de propósito. Ajuste minutos e preços antes de lançar. O texto do cadastro ("7 dias, 20 minutos") está escrito em `public/app.js`; se mudar o plano de teste, mude lá também.

Regras implementadas no banco (`supabase/migrations/0001_base.sql`):
- Novo usuário ganha perfil e assinatura **teste** por 7 dias, automaticamente.
- Os minutos são debitados **depois da transcrição**, pela duração real do áudio, uma vez por reunião (reprocessar não cobra de novo).
- Ordem: primeiro a franquia do plano, depois **minutos extras**. O excedente da última gravação é absorvido pelo plano.
- Envio é bloqueado (mensagem clara, HTTP 402) se o período acabou, se o saldo é zero ou se a gravação informada é maior que o saldo. Quem está bloqueado ainda vê, exporta e exclui o que já tem.
- Minutos do plano não acumulam para o período seguinte; minutos extras não expiram. (Decisão provisória: confirme.)
- Usuários não conseguem alterar plano, assinatura nem saldo (só leitura).

## Testes

- `bash supabase/tests/run.sh`: aplica a migração em um PostgreSQL temporário (com *stubs* de `auth` e `storage`) e testa gatilho de cadastro, saldo, RLS entre usuários, bloqueio de funções sensíveis e exclusão em cascata. Requer os binários do PostgreSQL.
- `npm test`: inclui testes do servidor contra um **Supabase falso** (cabeçalhos, mapeamento, isolamento, saldo, proxy de login). O falso **não** prova o RLS real; quem prova é o teste SQL acima.

## O que NÃO foi testado

- Contra um projeto Supabase real (Auth com e-mail de confirmação, Storage, PostgREST). Os stubs imitam apenas o necessário; diferenças de versão podem existir.
- Envio de e-mails, limites de taxa do Auth, comportamento com muitos usuários.

## Pendências conhecidas (próximas etapas)

- **Etapa 3:** cobrança, troca de plano, compra de minutos extras (`grant_extra_seconds` já existe), renovação do período.
- **Etapa 4:** termos de uso, política de privacidade, exclusão de conta pelo próprio usuário (apagar o usuário apaga os dados do banco em cascata, mas **os arquivos de áudio no Storage precisam ser removidos por uma rotina**), retenção de dados, limite de tentativas de login no servidor.
- Tokens da sessão ficam no `localStorage` do navegador (a página usa CSP restritiva e nunca insere HTML de terceiros, mas é um ponto a revisar antes de lançar).
- O processamento roda no servidor Node (sem limite curto de tempo, ao contrário de Edge Functions). Se o servidor reiniciar, reuniões pendentes são retomadas ao subir.
