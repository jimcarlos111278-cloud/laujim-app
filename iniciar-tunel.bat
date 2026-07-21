@echo off
echo Iniciando Cloudflare Tunnel...
echo.
echo La URL aparecera abajo. Abrela desde tu celular.
echo.
echo Para cerrar el tunel: cierra esta ventana
echo.
"%TEMP%\cloudflared.exe" tunnel --url http://127.0.0.1:1011 --no-autoupdate
pause
