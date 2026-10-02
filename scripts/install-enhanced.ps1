param([switch]$Notify)
$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $PSScriptRoot
$dataDir = if (Test-Path -LiteralPath (Join-Path $appDir 'installation.json')) { Join-Path (Split-Path -Parent $appDir) 'data' } else { $appDir }
$installer = Join-Path $appDir 'vendor\PawnIO\2.2.0\PawnIO_setup.exe'
$expectedHash = '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032'
$result = @{ exitCode = -1; failureCode='package-unavailable'; completedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
$child = $null
$handle = $null
$operationLock = $null
try {
    [IO.Directory]::CreateDirectory($dataDir) | Out-Null
    $operationLock = [IO.File]::Open((Join-Path $dataDir 'enhanced-install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    # Hold a read-only sharing handle through UAC/execution: no replacement/writes
    # can occur between validation and launch. Only the signed EXE is elevated.
    $handle = [IO.File]::Open($installer, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $result.failureCode='package-invalid'
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($handle)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($installer).FileVersion
    if ($hash -ne $expectedHash -or $signature.Status -ne 'Valid' -or $version -ne '2.2.0.0') { throw 'Package verification failed.' }
    $result.failureCode='launch-failed'
    $record = Join-Path $dataDir 'enhanced-install.json'
    if (Test-Path -LiteralPath $record) {
        $previous = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
        $boot = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime
        $bootMilliseconds = ([DateTimeOffset]$boot).ToUnixTimeMilliseconds()
        if ($previous.exitCode -eq 1460 -and $bootMilliseconds -le $previous.completedAt) { $result.exitCode = 1460; throw 'Previous installation unconfirmed; restart Windows before retrying.' }
    }
    # A crash during UAC/install leaves a persistent unconfirmed result instead
    # of permitting repeated privileged installers after a server restart.
    $pending = @{exitCode=1460;completedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
    [IO.File]::WriteAllText($record, ($pending | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
    # These exact flags select the normal signed edition. Never -unrestricted.
    $child = Start-Process -FilePath $installer -ArgumentList '-install', '-silent' -Verb RunAs -PassThru -ErrorAction Stop
    $result.exitCode = 1460
    if (-not $child.WaitForExit(240000)) { $result.exitCode = 1460; throw 'Installation result unconfirmed; inspect Windows before retrying.' }
    $result.exitCode = if ($null -ne $child.ExitCode) { [int]$child.ExitCode } else { 1460 }
    $result.failureCode='install-failed'
} catch {
    $native = $_.Exception
    while ($native.InnerException) { $native = $native.InnerException }
    if ($native.NativeErrorCode -eq 1223) { $result.exitCode = 1223 }
} finally { if ($handle) { $handle.Dispose() }; if ($child) { $child.Dispose() } }
$result.completedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
try {
    if (-not $operationLock) { throw 'Another installation owns the result record.' }
    $record = Join-Path $dataDir 'enhanced-install.json'
    [IO.Directory]::CreateDirectory($dataDir) | Out-Null
    [IO.File]::WriteAllText($record, ($result | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
} catch { } finally { if ($operationLock) { $operationLock.Dispose() } }
function Get-EnhancedInstallMessage($result) {
    $message = if ($result.exitCode -eq 0) { 'Enhanced hardware support installer completed successfully. CPU sensor availability is checked separately in the dashboard; virtual machines may have no compatible sensor. PC Monitor is ready to use.' }
      elseif ($result.exitCode -in @(3010,1641)) { 'Enhanced hardware support was installed. Restart Windows to finish setup. PC Monitor remains usable now.' }
      elseif ($result.exitCode -in @(1223,1602)) { 'Enhanced installation was cancelled. PC Monitor remains usable without CPU temperature.' }
      elseif ($result.exitCode -eq 1460) { 'The Enhanced installer has not returned a confirmed result. Check Windows; restart Windows before retrying. PC Monitor remains usable.' }
      elseif ($result.failureCode -eq 'package-invalid') { 'Enhanced installer signature, hash or version verification failed. Nothing was installed. PC Monitor remains usable.' }
      elseif ($result.failureCode -eq 'package-unavailable') { 'The trusted Enhanced installer is unavailable. PC Monitor remains usable.' }
      elseif ($result.failureCode -eq 'launch-failed') { 'The trusted Enhanced installer could not launch. PC Monitor remains usable.' }
      else { 'Enhanced hardware support installation failed (installer exit ' + $result.exitCode + '). PC Monitor remains usable without CPU temperature.' }
    return $message
}
if ($Notify) {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show((Get-EnhancedInstallMessage $result), 'PC Monitor - Enhanced Support') | Out-Null
}
$result | ConvertTo-Json -Compress
