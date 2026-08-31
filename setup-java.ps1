$jdk = Get-ChildItem -Path "C:\Program Files\Eclipse Adoptium" -Filter "jdk-*" -Directory | Select-Object -First 1
if ($jdk) {
  $javaHome = $jdk.FullName
  [Environment]::SetEnvironmentVariable("JAVA_HOME", $javaHome, "User")
  $path = [Environment]::GetEnvironmentVariable("Path", "User")
  $bin = $javaHome + "\bin"
  if ($path -notlike "*$bin*") {
    [Environment]::SetEnvironmentVariable("Path", $path + ";" + $bin, "User")
  }
  $env:JAVA_HOME = $javaHome
  $env:Path += ";" + $bin
  Write-Host "JAVA_HOME set to: $javaHome"
  java -version
} else {
  Write-Host "JDK not found in C:\Program Files\Eclipse Adoptium"
  Get-ChildItem "C:\Program Files\Eclipse Adoptium" -ErrorAction SilentlyContinue
}
