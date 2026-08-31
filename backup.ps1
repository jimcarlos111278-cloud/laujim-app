param(
  [string]$Message = ""
)

$repo = "C:\Users\jimca\OneDrive\Escritorio\Proyecto Laujim APP"
Set-Location -LiteralPath $repo

Write-Host "=== Respaldo Laujim APP ===" -ForegroundColor Cyan

# Verificar cambios
$status = git status --porcelain
if (-not $status) {
  Write-Host "No hay cambios nuevos que respaldar." -ForegroundColor Green
  exit 0
}

Write-Host "Cambios detectados:" -ForegroundColor Yellow
git status --short

# Commit
if ($Message) {
  $msg = "backup: $Message"
} else {
  $now = Get-Date -Format "yyyy-MM-dd HH:mm"
  $msg = "backup: cambios del $now"
}

git add -A
git commit -m $msg

Write-Host ""
Write-Host "Commit creado: $msg" -ForegroundColor Green
Write-Host "Archivos: $(($status -split "`n").Count) cambiados" -ForegroundColor Green

# Resumen
$log = git log --oneline -3
Write-Host "`nÚltimos commits:" -ForegroundColor Cyan
Write-Host $log
