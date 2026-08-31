$desktop = [Environment]::GetFolderPath('Desktop')
$wshell = New-Object -ComObject WScript.Shell
$shortcut = $wshell.CreateShortcut("$desktop\Gestion Apartamentos.lnk")
$shortcut.TargetPath = "C:\Users\jimca\Desktop\APP Laujim\iniciar-servidor-sync.bat"
$shortcut.Arguments = ""
$shortcut.WindowStyle = 1
$shortcut.WorkingDirectory = "C:\Users\jimca\Desktop\APP Laujim"
$shortcut.Description = "Iniciar servidor sincronizado de Gestion de Apartamentos"
$shortcut.Save()
Write-Host "Acceso directo creado en el escritorio"
