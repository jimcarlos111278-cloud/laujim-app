@echo off
title Stop Forever - Desactivar inicio automatico
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

:: Remove VBS launcher
if exist "%STARTUP%\LaujimApp.vbs" del "%STARTUP%\LaujimApp.vbs"
if exist "%STARTUP%\LaujimApp.url" del "%STARTUP%\LaujimApp.url"

echo ============================================
echo  INICIO AUTOMATICO DESACTIVADO
echo ============================================
echo  El servidor ya no arrancara solo al
echo  iniciar Windows.
echo ============================================
echo.
echo  Para activarlo: corre start-forever.bat
echo.
pause
