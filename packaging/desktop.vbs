Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & fso.BuildPath(appDir, "scripts\installed-desktop.ps1") & """"
If WScript.Arguments.Count > 0 Then
    If WScript.Arguments(0) = "setup" Then command = command & " -Setup"
End If
shell.Run command, 0, False
