$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assetRoot = (Resolve-Path $PSScriptRoot).Path

function New-BrandBitmap([string]$Path, [int]$Width, [int]$Height, [bool]$IsHeader) {
    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $bounds = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
    $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $bounds,
        [System.Drawing.Color]::FromArgb(17, 17, 22),
        [System.Drawing.Color]::FromArgb(33, 27, 47),
        90.0
    )
    $graphics.FillRectangle($background, $bounds)

    $accent = [System.Drawing.Color]::FromArgb(155, 123, 255)
    $softAccent = [System.Drawing.Color]::FromArgb(74, 57, 116)
    $linePen = New-Object System.Drawing.Pen($softAccent, 1.0)
    $glowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 155, 123, 255), 2.0)
    if ($IsHeader) {
        $graphics.DrawEllipse($glowPen, ($Width - 46), -18, 72, 72)
        $graphics.DrawEllipse($linePen, ($Width - 34), -7, 48, 48)
        $font = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $graphics.DrawString('Yui', $font, (New-Object System.Drawing.SolidBrush($accent)), 16, 13)
        $font.Dispose()
    } else {
        # Restrained sakura-inspired rings and arcs keep NSIS's narrow sidebar on-brand.
        for ($i = 0; $i -lt 5; $i++) {
            $diameter = 106 - ($i * 16)
            $x = [int](($Width - $diameter) / 2)
            $y = 34 + ($i * 8)
            $graphics.DrawEllipse($linePen, $x, $y, $diameter, $diameter)
        }
        $petalBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(130, 196, 179, 255))
        foreach ($point in @(@(82, 49), @(103, 69), @(82, 89), @(61, 69), @(82, 69))) {
            $graphics.FillEllipse($petalBrush, $point[0], $point[1], 9, 9)
        }
        $font = New-Object System.Drawing.Font('Segoe UI', 26, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $graphics.DrawString('Yui', $font, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 243, 250))), 48, 184)
        $font.Dispose()
        $subFont = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $graphics.DrawString('A BETTER WAY TO REMEMBER', $subFont, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(167, 162, 181))), 20, 223)
        $subFont.Dispose()
    }

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $linePen.Dispose()
    $glowPen.Dispose()
    $background.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

New-BrandBitmap (Join-Path $assetRoot 'installer-header.bmp') 150 57 $true
New-BrandBitmap (Join-Path $assetRoot 'installer-sidebar.bmp') 164 314 $false
