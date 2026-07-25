@echo off
title WhatsApp Proxy Bot - Laujim APP
cd /d "%~dp0whatsapp-bot"
echo ============================================
echo   WHATSAPP PROXY BOT
echo ============================================
echo.
echo Instalando dependencias...
call npm install --silent
echo.
echo Iniciando bot...
echo Si no ves el QR, espera unos segundos.
echo.
node index.js
pause
