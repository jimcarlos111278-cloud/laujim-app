@echo off
title Laujim App - Serveo Tunnel
cd /d "%~dp0"

:: Start Express server if not running
echo [1/3] Iniciando servidor Express...
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I "node.exe" >NUL
if %ERRORLEVEL% NEQ 0 (
    start /B node server.cjs
    timeout /T 3 /NOBREAK >NUL
) else (
    echo       Servidor ya corriendo
)

:: Start Serveo tunnel
echo [2/3] Iniciando tunel Serveo...
set SSH_KEY=%USERPROFILE%\.ssh\serveo_key

:retry
start /B "" "C:\Windows\System32\OpenSSH\ssh.exe" -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -i "%SSH_KEY%" -R laujim:80:127.0.0.1:1011 serveo.net
timeout /T 5 /NOBREAK >NUL

:: Check if tunnel connected
netstat -an | find "serveo.net:22" >NUL
if %ERRORLEVEL% NEQ 0 (
    echo [!] Reconectando en 10 segundos...
    timeout /T 10 /NOBREAK >NUL
    goto retry
)

echo [3/3] Tunel activo
echo.
echo ============================================
echo   APP:    https://laujim.serveousercontent.com
echo   EDITOR: https://laujim.serveousercontent.com/editor/
echo   USUARIO: admin
echo   PASS:   admin123
echo ============================================
echo.
echo Cerrando esta ventana detiene el tunel.
pause
