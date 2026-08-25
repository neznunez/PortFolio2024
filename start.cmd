@echo off
cd /d "%~dp0"
if not exist "node_modules\vite\bin\vite.js" (
  echo Dependencias em falta. A instalar...
  call npm.cmd install
)
node node_modules\vite\bin\vite.js
