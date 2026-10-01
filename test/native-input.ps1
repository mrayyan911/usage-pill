param([int]$X, [int]$Y, [ValidateSet('move', 'click', 'drag')][string]$Action = 'move', [int]$EndX, [int]$EndY)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PillTestMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
[void][PillTestMouse]::SetCursorPos($X, $Y)
if ($Action -eq 'click' -or $Action -eq 'drag') { [PillTestMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero) }
if ($Action -eq 'click') { Start-Sleep -Milliseconds 50 }
if ($Action -eq 'drag') {
  Start-Sleep -Milliseconds 100
  for ($step = 1; $step -le 10; $step++) {
    [void][PillTestMouse]::SetCursorPos($X + ($EndX - $X) * $step / 10, $Y + ($EndY - $Y) * $step / 10)
    Start-Sleep -Milliseconds 40
  }
}
if ($Action -eq 'click' -or $Action -eq 'drag') { [PillTestMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }
