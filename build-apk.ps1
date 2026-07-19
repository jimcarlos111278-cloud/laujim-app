$jdk = Get-ChildItem -Path "C:\Program Files\Eclipse Adoptium" -Filter "jdk-21*" -Directory | Select-Object -First 1
if (-not $jdk) { $jdk = Get-ChildItem -Path "C:\Program Files\Eclipse Adoptium" -Filter "jdk-*" -Directory | Select-Object -First 1 }
if ($jdk) {
    $env:JAVA_HOME = $jdk.FullName
    $env:Path += ";" + $jdk.FullName + "\bin"
}
$env:ANDROID_HOME = "C:\Android"
$env:ANDROID_SDK_ROOT = "C:\Android"

$projectRoot = $PSScriptRoot
Set-Location $projectRoot

Write-Host "PASO 1: Build Vite..." -ForegroundColor Cyan
& cmd /c "npm run build" 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host "BUILD FAILED"; exit 1 }

Write-Host "PASO 2: Capacitor sync..." -ForegroundColor Cyan
& cmd /c "npx cap copy android" 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host "CAP COPY FAILED"; exit 1 }

Write-Host "PASO 3: Compilando APK..." -ForegroundColor Cyan
if (Test-Path "$projectRoot\android") {
    Set-Location "$projectRoot\android"
} else {
    Write-Host "ERROR: No se encuentra la carpeta android"
    exit 1
}
& ".\gradlew.bat" assembleDebug 2>&1
if ($LASTEXITCODE -eq 0) {
    Set-Location $projectRoot
    Write-Host "PASO 4: Copiando APK..." -ForegroundColor Cyan
    & node scripts/copy-apk.js
    Copy-Item -LiteralPath "$projectRoot\android\app\build\outputs\apk\debug\app-debug.apk" -Destination "$projectRoot\public\app-debug.apk" -Force
    Write-Host "APK BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host "APK: $projectRoot\dist\app-debug.apk" -ForegroundColor Green
} else {
    Write-Host "BUILD FAILED with exit code $LASTEXITCODE" -ForegroundColor Red
}
