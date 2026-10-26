@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.
  pause
  exit /b 1
)
echo Iniciando o Confere. Deixe esta janela aberta enquanto usa o app; feche-a para encerrar.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server\index.js
pause
