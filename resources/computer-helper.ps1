param([string]$Json)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class EvrenInput
{
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT point);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }
}
"@

function Write-Result($object) {
    $object | ConvertTo-Json -Compress -Depth 8
}

try {
    $cmd = $Json | ConvertFrom-Json

    switch ($cmd.cmd) {
        'screen' {
            $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
            $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)
            $path = Join-Path $env:TEMP ("evren-screen-" + [guid]::NewGuid().ToString() + ".png")
            $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
            $graphics.Dispose()
            $bitmap.Dispose()
            Write-Result @{
                ok = $true
                path = $path
                width = $bounds.Width
                height = $bounds.Height
                originX = $bounds.X
                originY = $bounds.Y
            }
        }
        'move' {
            [EvrenInput]::SetCursorPos([int]$cmd.x, [int]$cmd.y) | Out-Null
            Write-Result @{ ok = $true }
        }
        'click' {
            [EvrenInput]::SetCursorPos([int]$cmd.x, [int]$cmd.y) | Out-Null
            Start-Sleep -Milliseconds 40
            $button = 'left'
            if ($cmd.button) { $button = [string]$cmd.button }
            $down = 0x0002
            $up = 0x0004
            if ($button -eq 'right') { $down = 0x0008; $up = 0x0010 }
            elseif ($button -eq 'middle') { $down = 0x0020; $up = 0x0040 }
            $count = 1
            if ($cmd.count) { $count = [int]$cmd.count }
            for ($i = 0; $i -lt $count; $i++) {
                [EvrenInput]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
                [EvrenInput]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
                Start-Sleep -Milliseconds 70
            }
            Write-Result @{ ok = $true }
        }
        'scroll' {
            $amount = 0
            if ($cmd.amount) { $amount = [int]$cmd.amount }
            [EvrenInput]::mouse_event(0x0800, 0, 0, ($amount * 120), [UIntPtr]::Zero)
            Write-Result @{ ok = $true }
        }
        'type' {
            $text = [string]$cmd.text
            $previous = ''
            try { $previous = [System.Windows.Forms.Clipboard]::GetText() } catch { $previous = '' }
            [System.Windows.Forms.Clipboard]::SetText($text)
            Start-Sleep -Milliseconds 30
            [System.Windows.Forms.SendKeys]::SendWait('^v')
            Start-Sleep -Milliseconds 120
            try {
                if ($previous) { [System.Windows.Forms.Clipboard]::SetText($previous) }
            } catch {
                # pano geri yuklenemedi
            }
            Write-Result @{ ok = $true }
        }
        'key' {
            [System.Windows.Forms.SendKeys]::SendWait([string]$cmd.keys)
            Start-Sleep -Milliseconds 80
            Write-Result @{ ok = $true }
        }
        'cursor' {
            $point = New-Object EvrenInput+POINT
            [EvrenInput]::GetCursorPos([ref]$point) | Out-Null
            Write-Result @{ ok = $true; x = $point.X; y = $point.Y }
        }
        default {
            Write-Result @{ ok = $false; error = "Bilinmeyen komut: $($cmd.cmd)" }
        }
    }
}
catch {
    Write-Result @{ ok = $false; error = $_.Exception.Message }
}
