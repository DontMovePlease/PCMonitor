$projectDir = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'start.ps1')
. (Join-Path $PSScriptRoot 'dashboard-runtime.ps1')
$runtime = Get-DashboardRuntime $projectDir
if ($runtime.state -ne 'owned' -or -not $runtime.healthy) { Write-Host '[ERROR] Dashboard is not responding; no desktop window opened.'; exit 1 }
$url = "http://127.0.0.1:$($runtime.port)"
if (Test-Path -LiteralPath (Join-Path $projectDir 'installation.json')) { Start-Process $url; return }
# Browser access is retained only for source-checkout development/diagnostics.
Start-Process $url
