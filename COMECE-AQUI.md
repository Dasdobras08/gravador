# Começar a usar o Confere (sem terminal)

## 1. Instale o Node.js (uma vez só)
Baixe a versão **LTS** em https://nodejs.org e instale aceitando as opções padrão.

## 2. Baixe o Confere
No GitHub, abra o repositório, escolha a branch `claude/meeting-recorder-mvp-pr`, clique em **Code → Download ZIP** e descompacte a pasta.

## 3. Abra o app
- **Windows:** clique duas vezes em `iniciar.bat`.
- **Mac:** clique duas vezes em `iniciar.command` (se o Mac bloquear: botão direito → Abrir).
- **Linux:** `bash iniciar.sh` no terminal.

O navegador abre em http://localhost:3000. Deixe a janela preta aberta enquanto usa; feche-a para encerrar.

Sem chave, o app abre em **modo demonstração** (a gravação funciona, mas a transcrição é um exemplo fixo).

## 4. (Opcional) IA real
1. Na pasta, copie `.env.example` e renomeie a cópia para `.env` (no Windows, ative "extensões de arquivo" no Explorador para poder renomear).
2. Abra o `.env` no Bloco de Notas e preencha a linha `OPENAI_API_KEY=` com a sua chave, sem espaços. Salve.
3. Feche a janela preta e abra `iniciar.bat` (ou `.command`) de novo. O selo no topo deve mostrar "IA: openai".

Nunca compartilhe o arquivo `.env` nem a chave.

## Problemas comuns
- **"Node.js não foi encontrado":** instale o Node e abra de novo.
- **"Address already in use" / porta ocupada:** o app já está aberto em outra janela; feche-a ou use outra porta (`PORT=3001` no `.env`).
- **Microfone bloqueado:** clique no cadeado ao lado do endereço e permita o microfone.
