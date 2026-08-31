Set ws = CreateObject("WScript.Shell")
ws.Run "cmd /c cd /d """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & """ && start /B node server.cjs && ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -i """ & ws.ExpandEnvironmentStrings("%USERPROFILE%") & "\.ssh\serveo_key"" -R laujim:80:127.0.0.1:1011 serveo.net", 0, False
