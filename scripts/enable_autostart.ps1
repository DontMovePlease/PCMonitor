$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location $projectDir

$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'PC-Dashboard.lnk'
$vbsPath = Join-Path $projectDir 'run_hidden.vbs'
$wscriptPath = Join-Path $env:SystemRoot 'System32\wscript.exe'

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $wscriptPath
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $projectDir
$shortcut.Description = "PC Monitor Dashboard Background Service"
$shortcut.Save()

if (Test-Path $shortcutPath) {
    Write-Host "[SUCCESS] Automatic Windows startup is now ENABLED!" -ForegroundColor Green
    Write-Host "Startup shortcut created in:" -ForegroundColor Gray
    Write-Host "  $shortcutPath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "The dashboard will now silently start in the background when Windows boots." -ForegroundColor Cyan
    Write-Host "You can also view or toggle it in Task Manager > Startup Apps." -ForegroundColor Gray
} else {
    Write-Host "[ERROR] Could not create shortcut in startup folder." -ForegroundColor Red
}
