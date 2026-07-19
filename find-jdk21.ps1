$jdk = Get-ChildItem -Path "C:\Program Files\Eclipse Adoptium" -Filter "jdk-21*" -Directory | Select-Object -First 1
if ($jdk) {
    Write-Host $jdk.FullName
} else {
    Write-Host "NOT_FOUND"
}
