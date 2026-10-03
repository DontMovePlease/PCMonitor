Option Explicit
Dim shell, files, root, script, powershell, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
script = files.BuildPath(root, "scripts\release-manager-launch.ps1")
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
If Not files.FileExists(script) Then
  MsgBox "Release Manager launcher is missing: " & script, 16, "Rovarin Release Manager"
  WScript.Quit 1
End If
On Error Resume Next
result = shell.Run("""" & powershell & """ -NoProfile -STA -ExecutionPolicy Bypass -File """ & script & """", 0, True)
If Err.Number <> 0 Then
  MsgBox "Release Manager could not start: " & Err.Description, 16, "Rovarin Release Manager"
  WScript.Quit 1
End If
WScript.Quit result
