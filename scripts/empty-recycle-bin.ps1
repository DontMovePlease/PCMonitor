$ErrorActionPreference = 'Stop'
function Read-RecycleCount {
    $shell=$null; $folder=$null; $items=$null
    try {
        $shell=New-Object -ComObject Shell.Application
        $folder=$shell.Namespace(10)
        if ($null -eq $folder) { return $null }
        $items=$folder.Items()
        if ($null -eq $items -or $null -eq $items.Count) { return $null }
        $count=0
        if ([int]::TryParse([string]$items.Count,[ref]$count) -and $count -ge 0) { return $count }
        return $null
    } catch { return $null }
    finally {
        foreach($object in @($items,$folder,$shell)) {
            if ($null -ne $object -and [Runtime.InteropServices.Marshal]::IsComObject($object)) {
                try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($object) } catch { }
            }
        }
    }
}
$before=Read-RecycleCount
$result=@{success=$false;code='clear-failed';before=$before;remaining=$null;verified=$false}
try {
    if (-not (Get-Command Clear-RecycleBin -ErrorAction SilentlyContinue)) { $result.code='tool-unavailable' }
    elseif ($null -ne $before -and $before -eq 0) {
        $result.success=$true; $result.code='already-empty'; $result.remaining=0; $result.verified=$true
    } else {
        # Supported current-user/all-drive operation; no client paths/arguments.
        Clear-RecycleBin -Force -ErrorAction Stop
        foreach($delay in @(0,300,700,1500)) {
            if($delay){Start-Sleep -Milliseconds $delay}
            # A new COM view each time avoids retaining a stale Shell snapshot.
            $remaining=Read-RecycleCount
            if($null -ne $remaining){$result.remaining=$remaining}
            if($null -ne $remaining -and $remaining -eq 0){break}
        }
        if($null -eq $remaining){$result.success=$true;$result.code='verification-unavailable'}
        elseif($remaining -eq 0){$result.success=$true;$result.code='emptied';$result.verified=$true}
        else {$result.code='items-remain';$result.verified=$true}
    }
} catch {
    $exception=$_.Exception
    while($exception.InnerException){$exception=$exception.InnerException}
    $result.code=if($exception -is [UnauthorizedAccessException] -or $exception.HResult -eq -2147024891){'permission-denied'}else{'clear-failed'}
    # Do not convert a confirmed command failure into success based on COM.
}
$result | ConvertTo-Json -Compress
if(-not $result.success){exit 1}
