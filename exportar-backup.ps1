param(
  [string]$Destino = "C:\Users\jimca\OneDrive\Escritorio\Backups Laujim"
)

$repo = "C:\Users\jimca\OneDrive\Escritorio\Proyecto Laujim APP"
$fecha = Get-Date -Format "yyyy-MM-dd_HHmm"
$archivo = "$Destino\laujim-backup-$fecha.zip"

if (-not (Test-Path $Destino)) {
  New-Item -ItemType Directory -Path $Destino -Force | Out-Null
}

Write-Host "=== Exportando backup a $Destino ===" -ForegroundColor Cyan

# Excluir node_modules, dist, android build, git
$excluir = @('node_modules', 'dist', 'android\.gradle', 'android\build', 'android\app\build', '.git', 'uploads\photos', 'app-debug.apk', 'public\app-debug.apk')

if (Test-Path $archivo) {
  Write-Host "Error: Ya existe $archivo" -ForegroundColor Red
  exit 1
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($archivo, [System.IO.Compression.ZipArchiveMode]::Create)
$srcLen = ($repo.Length + 1)

Get-ChildItem $repo -Recurse | ForEach-Object {
  $rel = $_.FullName.Substring($srcLen)
  $excluido = $false
  foreach ($patron in $excluir) {
    if ($rel -match $patron) { $excluido = $true; break }
  }
  if (-not $excluido -and -not $_.PSIsContainer) {
    $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
  }
}
$zip.Dispose()

Write-Host "Backup creado: $archivo" -ForegroundColor Green
$tamano = [math]::Round((Get-Item $archivo).Length / 1MB, 2)
Write-Host "Tamaño: ${tamano} MB" -ForegroundColor Green

# Mantener solo los últimos 10 backups
Get-ChildItem "$Destino\laujim-backup-*.zip" | Sort-Object Name -Descending | Select-Object -Skip 10 | ForEach-Object {
  Remove-Item $_.FullName -Force
  Write-Host "Backup antiguo eliminado: $($_.Name)" -ForegroundColor DarkYellow
}
