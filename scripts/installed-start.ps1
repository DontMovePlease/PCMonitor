$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $PSScriptRoot
$installDir = Split-Path -Parent $appDir
. (Join-Path $PSScriptRoot 'dashboard-runtime.ps1')
$runtime = Get-DashboardRuntime $appDir
if ($runtime.state -eq 'owned' -and $runtime.healthy) { exit 0 }
if ($runtime.state -ne 'none') { exit 1 }
$dataDir = Join-Path $installDir 'data'
[IO.Directory]::CreateDirectory($dataDir) | Out-Null
$node = Join-Path $installDir 'runtime\node.exe'
$server = Join-Path $appDir 'server.js'
# Hardening inherited Node flags is specific to packaged launch, not dev.
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
Remove-Item Env:PC_MONITOR_PIN -ErrorAction SilentlyContinue
Remove-Item Env:PORT -ErrorAction SilentlyContinue
Start-Process -FilePath $node -ArgumentList "`"$server`"" -WorkingDirectory $appDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataDir 'server.log') -RedirectStandardError (Join-Path $dataDir 'server-error.log') | Out-Null
