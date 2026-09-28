#Requires -Version 5.1
<#
  Abre Chrome con DevTools remoto para manejo por CDP (driver: scratch/cdp-drive.py).
  Cierra el Chrome actual (guarda lo importante: restaura pestañas al abrir).
  Uso: powershell -ExecutionPolicy Bypass -File scripts\open-chrome-cdp.ps1 [-Port 9222]
#>
param([int]$Port = 9222)
taskkill /F /IM chrome.exe /T 2>$null | Out-Null
Start-Sleep -Seconds 3
Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--remote-debugging-port=$Port", '--remote-allow-origins=*'
Start-Sleep -Seconds 6
try {
  $v = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 8
  Write-Host "CDP_OK puerto $Port"
} catch {
  Write-Host "CDP_FAIL: revisa que Chrome haya abierto."
}
