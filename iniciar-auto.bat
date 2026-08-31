@echo off
title Laujim App
cd /d "%~dp0"

:: Start Express
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I "node.exe" >NUL
if %ERRORLEVEL% NEQ 0 start /B node server.cjs

:: Start Serveo tunnel
set SSH_KEY=%USERPROFILE%\.ssh\serveo_key

:retry
start /B "" "C:\Windows\System32\OpenSSH\ssh.exe" -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -i "%SSH_KEY%" -R laujim:80:127.0.0.1:1011 serveo.net
timeout /T 8 /NOBREAK >NUL
netstat -an 2>NUL | find "serveo.net:22" >NUL
if %ERRORLEVEL% NEQ 0 (
    timeout /T 10 /NOBREAK >NUL
    goto retry
)
:: Keep alive (no pause)
:loop
timeout /T 60 /NOBREAK >NUL
goto loop
