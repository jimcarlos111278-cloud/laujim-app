# setup-ssh-any-pc.ps1
# Configura el acceso SSH universal al servidor Laujim (149.130.160.116)
# Ejecutable en CUALQUIER PC Windows en una sola línea:
# powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/jimcarlos111278-cloud/laujim-app/main/scripts/setup-ssh-any-pc.ps1 | iex"

$ErrorActionPreference = 'Stop'
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "🚀 CONFIGURANDO ACCESO SSH UNIVERSAL A LAUJIM VM" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$sshDir = Join-Path $HOME ".ssh"
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
    Write-Host "📁 Directorio $sshDir creado." -ForegroundColor Gray
}

# Llave privada de acceso ED25519 para laujim
$keyBase64 = "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUFNd0FBQUF0emMyZ3RaVwpReU5UVXhPUUFBQUNEd0lLQVV4VEo1SnI0SFhmMXdBNVA0d1YxZk9DcEl6ck03SFpReWE3L2dEUUFBQUtCZnBCRWVYNlFSCkhnQUFBQXR6YzJndFpXUXlOVFV4T1FBQUFDRHdJS0FVeFRKNUpyNEhYZjF3QTVQNHdWMWZPQ3BJenJNN0haUXlhNy9nRFEKQUFBRUQ2UkJGdEd5dTR6QlZmUllxL0ozWkhadS9NZEdUS1FFM1paM1hPY3dBTUp2QWdvQlRGTW5rbXZnZGQvWEFEay9qQgpYVjg0S2tqT3N6c2RsREpyditBTkFBQUFIWFZpZFc1MGRVQnNZWFZxYVcwdGRtNXBZeTB5TURJMkxUQTVMVEV4Ci0tLS0tRU5EIE9QRU5TU0ggUFJJVkFURSBLRVktLS0tLQo="
$keyPath = Join-Path $sshDir "id_ed25519_laujim"
[System.IO.File]::WriteAllBytes($keyPath, [System.Convert]::FromBase64String($keyBase64))
Write-Host "🔑 Llave SSH id_ed25519_laujim guardada correctamente." -ForegroundColor Green

# Configurar Host laujim en ~/.ssh/config
$configPath = Join-Path $sshDir "config"
$hostConfig = @"

Host laujim
  HostName 149.130.160.116
  User ubuntu
  IdentityFile ~/.ssh/id_ed25519_laujim
  StrictHostKeyChecking accept-new
"@

$needsConfig = $true
if (Test-Path $configPath) {
    $existing = Get-Content $configPath -Raw
    if ($existing -match "Host\s+laujim\b") {
        $needsConfig = $false
        Write-Host "⚙️ Host 'laujim' ya configurado en $configPath." -ForegroundColor Gray
    }
}

if ($needsConfig) {
    Add-Content -Path $configPath -Value $hostConfig
    Write-Host "⚙️ Host 'laujim' agregado a $configPath." -ForegroundColor Green
}

# Prueba de conexión inmediata
Write-Host "`n📡 Verificando conexión SSH remota con la VM..." -ForegroundColor Yellow
try {
    $out = ssh -o ConnectTimeout=8 laujim "echo 'CONECTADO_OK'" 2>&1
    if ($out -match 'CONECTADO_OK') {
        Write-Host "✅ ¡Conexión SSH exitosa! Ya puedes usar 'ssh laujim' en esta máquina." -ForegroundColor Green
    } else {
        Write-Host "⚠️ Respuesta: $out" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Error probando conexión: $_" -ForegroundColor Red
}

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "Uso listo: Simplemente escribe 'ssh laujim' en tu terminal." -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
