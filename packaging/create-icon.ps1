# Original vector-derived Rovarin mark; no external image or licensing dependency.
param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$frames=@()
foreach($size in @(16,32,48,256)) {
    $bitmap=New-Object Drawing.Bitmap($size,$size)
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([Drawing.Color]::FromArgb(255,15,22,34))
        $scale=$size/64.0
        $graphics.ScaleTransform($scale,$scale)
        $pen=New-Object Drawing.Pen([Drawing.Color]::FromArgb(255,74,209,223),3)
        try {
            $graphics.DrawRectangle($pen,9,12,46,34)
            $points=[Drawing.PointF[]]@((New-Object Drawing.PointF(14,31)),(New-Object Drawing.PointF(23,31)),(New-Object Drawing.PointF(28,22)),(New-Object Drawing.PointF(34,39)),(New-Object Drawing.PointF(39,29)),(New-Object Drawing.PointF(50,29)))
            $graphics.DrawLines($pen,$points)
            $graphics.DrawLine($pen,32,46,32,53);$graphics.DrawLine($pen,23,54,41,54)
        } finally {$pen.Dispose()}
        $memory=New-Object IO.MemoryStream
        try {$bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png);$frames+=,@{size=$size;bytes=$memory.ToArray()}} finally {$memory.Dispose()}
    } finally {$graphics.Dispose();$bitmap.Dispose()}
}
$file=[IO.File]::Create($Output);$writer=New-Object IO.BinaryWriter($file)
try {
    $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$frames.Count)
    $offset=6+16*$frames.Count
    foreach($frame in $frames){$s=if($frame.size -eq 256){0}else{$frame.size};$writer.Write([byte]$s);$writer.Write([byte]$s);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$frame.bytes.Length);$writer.Write([uint32]$offset);$offset+=$frame.bytes.Length}
    foreach($frame in $frames){$writer.Write([byte[]]$frame.bytes)}
} finally {$writer.Dispose();$file.Dispose()}
