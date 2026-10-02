$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'PC-Dashboard.lnk'

if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "[SUCCESS] Automatic Windows startup is now DISABLED." -ForegroundColor Green
    Write-Host "Removed shortcut: $shortcutPath" -ForegroundColor Gray
    Write-Host "The dashboard will NO LONGER launch automatically on boot." -ForegroundColor Cyan
} else {
    Write-Host "[INFO] Automatic startup was not enabled (no shortcut in Startup folder)." -ForegroundColor Yellow
}
