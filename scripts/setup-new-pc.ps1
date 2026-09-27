#Requires -Version 5.1
<#
  Deja un PC nuevo listo y abre la IA en la VM, todo de una vez.
  Uso (una sola línea, sin clonar nada antes):
  powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/jimcarlos111278-cloud/laujim-app/main/scripts/setup-new-pc.ps1 | iex"
  Variables opcionales antes: $env:LAUJIM_DIR (destino), $env:LAUJIM_IA (opencode|codex|agy).
  Lo único manual: el login de Tailscale (tu identidad, 30 s).
#>
$ErrorActionPreference = 'Stop'
$Dest = if ($env:LAUJIM_DIR) { $env:LAUJIM_DIR } else { Join-Path $HOME 'laujim-app' }
$Ia = if ($env:LAUJIM_IA) { $env:LAUJIM_IA } else { 'opencode' }

function Find-Tailscale {
  $c = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = 'C:\Program Files\Tailscale\tailscale.exe'
  if (Test-Path $p) { return $p }
  return $null
}

# 1. Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host '[1/4] Instalando Git...' -ForegroundColor Cyan
  winget install --id Git.Git --silent --accept-package-agreements --accept-source-agreements
  $env:Path += ';C:\Program Files\Git\cmd'
}

# 2. Tailscale
$ts = Find-Tailscale
if (-not $ts) {
  Write-Host '[2/4] Instalando Tailscale...' -ForegroundColor Cyan
  winget install --id Tailscale.Tailscale --silent --accept-package-agreements --accept-source-agreements
  $ts = Find-Tailscale
}
if (-not $ts) { throw 'No se pudo instalar Tailscale.' }

# 3. Repo
$launcher = Join-Path $Dest 'scripts\open-vm-opencode.ps1'
if (-not (Test-Path $launcher)) {
  Write-Host '[3/4] Clonando repo...' -ForegroundColor Cyan
  git clone https://github.com/jimcarlos111278-cloud/laujim-app.git $Dest
} else {
  git -C $Dest pull --ff-only | Out-Null
}

# 4. Login Tailscale (lo único manual)
$st = (& $ts status 2>&1 | Out-String)
if ($st -match 'NeedsLogin|Logged out') {
  Write-Host '[4/4] Falta tu login: bandeja -> Tailscale -> Log in (misma cuenta).' -ForegroundColor Yellow
  Read-Host 'Pulsa Enter cuando este Connected'
}

# 5. Abrir IA en la VM
& $launcher -Ia $Ia
