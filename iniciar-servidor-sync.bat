@echo off
title Gesti?n de Apartamentos - SERVIDOR SINCRONIZADO
cd /d "C:\Users\jimca\OneDrive\Escritorio\Proyecto Laujim APP"
echo ============================================
echo   GESTION DE APARTAMENTOS
echo   MODO SERVIDOR (datos compartidos)
echo ============================================
echo.
echo  PASO 1: Compilando la aplicacion...
call npm run build
echo.
echo  PASO 2: Iniciando servidor...
echo.
echo  Abre en cualquier dispositivo:
echo    http://localhost:1011
echo.
echo  Datos guardados en: data/database.json
echo  TODOS los dispositivos ven la misma info.
echo.
echo ============================================
echo.
node server.cjs
pause
