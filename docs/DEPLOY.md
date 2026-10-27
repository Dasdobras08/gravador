# Hospedar o Confere (para usar pelo celular)

O app é um servidor Node com disco para guardar os áudios. Hospedando-o, você acessa por um endereço `https://…` (necessário para o microfone funcionar no celular).

## Antes de tudo

1. **Senha obrigatória.** Fora do `localhost` o app só inicia com `APP_PASSWORD` definida. O navegador pede usuário e senha: use qualquer usuário e essa senha.
2. **Chave da OpenAI** (`OPENAI_API_KEY`) para transcrição real. Sem ela roda em modo demonstração.
3. **Guarde ambos como segredos/variáveis de ambiente da plataforma**, nunca no repositório.
4. **Disco persistente.** Os dados ficam em `DATA_DIR` (no Docker, `/data`). Se a plataforma não tiver volume persistente, as reuniões somem a cada reinício ou nova publicação.
5. Áudio e transcrição passam pela OpenAI e ficam no servidor da plataforma: só use com reuniões que você tem autorização para gravar.

## Com Docker (qualquer plataforma que aceite contêineres)

```bash
docker build -t confere .
docker run -p 3000:3000 -v confere-data:/data \
  -e APP_PASSWORD='uma-senha-forte' -e OPENAI_API_KEY='sk-...' confere
```

## Exemplo: Fly.io

```bash
fly launch --no-deploy            # usa o Dockerfile; escolha nome e região
fly volumes create data --size 1
fly secrets set APP_PASSWORD='uma-senha-forte' OPENAI_API_KEY='sk-...'
```

No `fly.toml` gerado, adicione o volume e a porta interna:

```toml
[mounts]
  source = "data"
  destination = "/data"

[http_service]
  internal_port = 3000
  force_https = true
```

Depois `fly deploy` e abra o endereço `https://<nome>.fly.dev` no celular.

## Exemplo: Render

Crie um *Web Service* a partir do repositório, escolhendo o ambiente Docker. Em *Environment*, defina `APP_PASSWORD` e `OPENAI_API_KEY`. Adicione um *Disk* montado em `/data`. Sem disco, os dados não persistem.

> Os passos de plataforma acima não foram executados por quem escreveu este guia; os comandos e telas podem ter mudado. Em caso de divergência, vale a documentação da plataforma.

## Verificação rápida

- Abrir o endereço sem senha deve pedir usuário e senha.
- O selo no topo deve mostrar "IA: openai".
- No celular, "Iniciar gravação" deve pedir permissão do microfone.
