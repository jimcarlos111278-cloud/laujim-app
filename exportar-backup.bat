@echo off
cd /d "C:\Users\jimca\OneDrive\Escritorio\Proyecto Laujim APP"
powershell -ExecutionPolicy Bypass -File "exportar-backup.ps1" %*
pause