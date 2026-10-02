param([ValidateSet('enhanced', 'thermal-zone')][string]$Mode, [switch]$StatusOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$result = @{ status = 'unavailable'; code = 'no-sensors'; admin = $admin }
$computer = $null
try {
    if ($Mode -eq 'thermal-zone') {
        $values = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | ForEach-Object { ([double]$_.CurrentTemperature / 10) - 273.15 } | Where-Object { $_ -ge 0 -and $_ -le 125 })
        if ($values.Count) { $result.status = 'available'; $result.temperatureC = ($values | Measure-Object -Maximum).Maximum }
        else { $result.code = 'thermal-zone-unavailable' }
    } else {
        $library = Join-Path (Split-Path $PSScriptRoot -Parent) 'vendor\LibreHardwareMonitor\0.9.6\LibreHardwareMonitorLib.dll'
        [void][Reflection.Assembly]::LoadFrom($library)
        $result.pawnIoInstalled = [LibreHardwareMonitor.PawnIo.PawnIo]::IsInstalled
        if ($StatusOnly) { $result.code=if($result.pawnIoInstalled){'not-sampled'}else{'pawnio-missing'}; $result | ConvertTo-Json -Compress; return }
        if (-not $result.pawnIoInstalled) { $result.code = 'pawnio-missing' }
        else {
            $computer = New-Object LibreHardwareMonitor.Hardware.Computer
            # All other hardware categories remain disabled (library defaults).
            $computer.IsCpuEnabled = $true
            $computer.Open()
            $cpus = @($computer.Hardware | Where-Object { $_.HardwareType.ToString() -eq 'Cpu' })
            if (-not $cpus.Count) { $result.code = 'unsupported-cpu' }
            else {
                $sensors = @()
                foreach ($cpu in $cpus) {
                    $cpu.Update()
                    foreach ($sensor in $cpu.Sensors) {
                        if ($sensor.SensorType.ToString() -eq 'Temperature' -and $null -ne $sensor.Value) {
                            $sensors += @{ hardwareType = 'Cpu'; sensorType = 'Temperature'; name = $sensor.Name; value = [double]$sensor.Value }
                        }
                    }
                }
                $result.status = 'available'; $result.sensors = $sensors
            }
        }
    }
} catch {
    $denied = $_.Exception -is [UnauthorizedAccessException] -or $_.Exception.HResult -eq -2147024891 -or [string]$_.Exception.NativeErrorCode -eq 'AccessDenied'
    $result.status = if ($denied -or $Mode -eq 'enhanced') { 'failed' } else { 'unavailable' }
    $result.code = if ($denied) { 'access-denied' } elseif ($Mode -eq 'enhanced') { 'provider-load-failed' } else { 'thermal-zone-unavailable' }
} finally {
    if ($null -ne $computer) { try { $computer.Close() } catch { $result.status = 'failed'; $result.code = 'provider-load-failed' } }
}
$result | ConvertTo-Json -Depth 5 -Compress
