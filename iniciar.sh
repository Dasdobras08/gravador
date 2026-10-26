#!/bin/bash
# Mac: clique duas vezes. Se o Mac bloquear, clique com o botão direito > Abrir.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "O Node.js não foi encontrado. Instale a versão LTS em https://nodejs.org e abra este arquivo de novo."
  read -r -p "Pressione Enter para fechar..." _
  exit 1
fi
echo "Iniciando o Confere. Deixe esta janela aberta enquanto usa o app; feche-a para encerrar."
( sleep 2; open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null ) &
node server/index.js
