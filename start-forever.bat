@echo off
title Start Forever - Activar inicio automatico
cd /d "%~dp0"
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SCRIPTPATH=%~dp0

:: Create VBS launcher in startup folder
set VBS=%STARTUP%\LaujimApp.vbs
echo Set ws = CreateObject("WScript.Shell") > "%VBS%"
echo ws.Run "cmd /c cd /d %SCRIPTPATH% && iniciar-auto.bat", 0, False >> "%VBS%"

echo ============================================
echo  INICIO AUTOMATICO ACTIVADO
echo ============================================
echo  Al iniciar Windows se ejecutara:
echo    - Servidor Express (node server.cjs)
echo    - Tunel Serveo (https://laujim.serveousercontent.com)
echo ============================================
echo.
echo  Para desactivarlo: corre stop-forever.bat
echo.
pause
