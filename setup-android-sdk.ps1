$jdk = Get-ChildItem -Path "C:\Program Files\Eclipse Adoptium" -Filter "jdk-*" -Directory | Select-Object -First 1
$env:JAVA_HOME = $jdk.FullName
$env:Path += ";" + $jdk.FullName + "\bin"

$androidHome = "C:\Android"
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $androidHome, "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $androidHome, "User")
$cmdline = "$androidHome\cmdline-tools\latest\bin"
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$cmdline*") {
  [Environment]::SetEnvironmentVariable("Path", $currentPath + ";" + $cmdline, "User")
}
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
$env:Path += ";" + $cmdline

Write-Host "ANDROID_HOME set to: $androidHome"

# Accept licenses and install required components
& "$cmdline\sdkmanager.bat" --licenses --sdk_root=$androidHome 2>&1 | Out-Null
# The yes command output for licenses
@("y") * 50 | & "$cmdline\sdkmanager.bat" --licenses --sdk_root=$androidHome 2>&1 | Out-Null

Write-Host "Installing platform-tools..."
& "$cmdline\sdkmanager.bat" "platform-tools" --sdk_root=$androidHome 2>&1

Write-Host "Installing build-tools..."
& "$cmdline\sdkmanager.bat" "build-tools;36.0.0" --sdk_root=$androidHome 2>&1

Write-Host "Installing platform android-36..."
& "$cmdline\sdkmanager.bat" "platforms;android-36" --sdk_root=$androidHome 2>&1

Write-Host "SDK setup complete!"

# Verify
Get-ChildItem "$androidHome\platforms" -Name
Get-ChildItem "$androidHome\build-tools" -Name
Get-ChildItem "$androidHome\platform-tools" -Name -ErrorAction SilentlyContinue | Select-Object -First 5
