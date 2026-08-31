@echo off
title Gesti?n de Apartamentos
cd /d "C:\Users\jimca\OneDrive\Escritorio\Proyecto Laujim APP"
echo ============================================
echo   GESTION DE APARTAMENTOS
echo ============================================
echo.
echo  Elige el modo:
echo.
echo  1 - MODO LOCAL (solo este PC, rapido)
echo      Usa: npx vite --host
echo      URL: http://localhost:5173 (puerto dev)
echo      Datos: Solo en este navegador
echo.
echo  2 - MODO SERVIDOR (compartido varios dispositivos)
echo      Usa: iniciar-servidor-sync.bat
echo      URL: http://localhost:1011
echo      Datos: Compartidos entre todos
echo.
echo ============================================
echo.
echo  Presiona Ctrl+C para salir, o abre
echo  directamente iniciar-servidor-sync.bat
echo  para usar el modo compartido.
echo.
pause
