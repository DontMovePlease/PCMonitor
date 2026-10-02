$ErrorActionPreference = 'Stop'
# Development-only native client: reuse the source checkout's safe lifecycle.
$projectDir = Split-Path -Parent $PSScriptRoot
try {
    & (Join-Path $PSScriptRoot 'start.ps1') *>&1 | Out-Null
    . (Join-Path $PSScriptRoot 'dashboard-runtime.ps1')
    $runtime = Get-DashboardRuntime $projectDir
    if ($runtime.state -ne 'owned' -or -not $runtime.healthy) { throw 'not-ready' }
    @{ ready=$true; port=[int]$runtime.port } | ConvertTo-Json -Compress
} catch { @{ ready=$false; port=0 } | ConvertTo-Json -Compress; exit 1 }
