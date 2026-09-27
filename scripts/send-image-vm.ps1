# send-image-vm.ps1: mini-SFTP de imagenes a la VM.
# Flujo: copia una captura (Win+Shift+S) o archivo(s) con Ctrl+C, corre este
# script, y pega con Ctrl+V la ruta en opencode (la deja en tu portapapeles).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\send-image-vm.ps1 [-Destino /tmp/laujim-img]
param([string]$Destino = '/tmp/laujim-img')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$files = @()
if ([Windows.Forms.Clipboard]::ContainsImage()) {
  $img = [Windows.Forms.Clipboard]::GetImage()
  $name = 'clip-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png'
  $tmp = Join-Path $env:TEMP $name
  $img.Save($tmp, [Drawing.Imaging.ImageFormat]::Png)
  $img.Dispose()
  $files += $tmp
} elseif ([Windows.Forms.Clipboard]::ContainsFileDropList()) {
  foreach ($f in [Windows.Forms.Clipboard]::GetFileDropList()) { $files += [string]$f }
} else {
  throw 'Portapapeles vacio: copia una imagen (Win+Shift+S) o archivos con Ctrl+C primero.'
}
$out = & py -3 (Join-Path $PSScriptRoot '..\scratch\send-files-vm.py') $Destino $files 2>&1 | Out-String
$paths = @()
foreach ($line in ($out -split "`r?`n")) {
  if ($line -match '^VM_PATH:(.+)$') { $paths += $Matches[1].Trim() }
}
if ($paths.Count -eq 0) { throw "Subida fallo:`n$out" }
Set-Clipboard ($paths -join "`n")
Write-Host 'En la VM:' -ForegroundColor Green
$paths | ForEach-Object { Write-Host "  $_" }
Write-Host 'Ruta(s) copiada(s): pegalas con Ctrl+V en opencode. Ej: mira /tmp/laujim-img/clip-....png' -ForegroundColor Cyan
