Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
shortcut = fso.BuildPath(shell.SpecialFolders("Startup"), "Rovarin.lnk")
If fso.FileExists(shortcut) Then
    Set link = shell.CreateShortcut(shortcut)
    appDir = fso.GetParentFolderName(WScript.ScriptFullName)
    If (StrComp(link.TargetPath, fso.BuildPath(appDir, "Rovarin.exe"), vbTextCompare) = 0 And link.Arguments = "startup") Or (InStr(1, link.TargetPath, "\wscript.exe", vbTextCompare) > 0 And link.Arguments = Chr(34) & fso.BuildPath(appDir, "startup.vbs") & Chr(34)) Then fso.DeleteFile shortcut
End If
MsgBox "Rovarin startup is disabled. You can still open it from the desktop or Start menu.", 64, "Rovarin"
