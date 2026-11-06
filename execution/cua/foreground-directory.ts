import { spawn } from 'node:child_process';

export const foregroundDirectoryScript = String.raw`
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FolderForeground {
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int command);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public static bool Activate(IntPtr handle) {
    IntPtr root = GetAncestor(handle, 2);
    if (root != IntPtr.Zero) handle = root;
    if (IsIconic(handle)) ShowWindowAsync(handle, 9);
    uint current = GetCurrentThreadId();
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    bool attached = foreground != 0 && current != foreground && AttachThreadInput(current, foreground, true);
    try {
      BringWindowToTop(handle);
      SetForegroundWindow(handle);
      if (GetForegroundWindow() != handle && (GetWindowLong(handle, -20) & 8) == 0) {
        try { SetWindowPos(handle, new IntPtr(-1), 0, 0, 0, 0, 0x43); }
        finally { SetWindowPos(handle, new IntPtr(-2), 0, 0, 0, 0, 0x43); }
        SetForegroundWindow(handle);
      }
      return GetForegroundWindow() == handle;
    } finally { if (attached) AttachThreadInput(current, foreground, false); }
  }
}
'@
function Find-FolderWindow($shell, $target) {
  foreach ($window in @($shell.Windows())) {
    try {
      $folder = [string]$window.Document.Folder.Self.Path
      if ([string]::Equals($folder.TrimEnd('\'), $target.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        return $window
      }
    } catch { }
  }
  return $null
}
try {
  $item = Get-Item -LiteralPath $env:CUA_OPEN_DIRECTORY -ErrorAction Stop
  if (-not $item.PSIsContainer) { throw '目标路径不是文件夹' }
  $target = $item.FullName
  $shell = New-Object -ComObject Shell.Application
  $shell.Open($target)
  $deadline = [DateTime]::UtcNow.AddSeconds(8)
  do {
    $window = Find-FolderWindow $shell $target
    if ($null -ne $window -and [FolderForeground]::Activate([IntPtr]$window.HWND)) { exit 0 }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw '文件夹已请求打开，但未能确认窗口置于前台，请检查 Windows 桌面权限'
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

export function openWindowsDirectory(directory: string, spawnProcess: typeof spawn = spawn): Promise<void> {
  const encoded = Buffer.from(foregroundDirectoryScript, 'utf16le').toString('base64');
  return new Promise<void>((resolve, reject) => {
    const child = spawnProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], {
      shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, CUA_OPEN_DIRECTORY: directory },
    });
    let detail = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('等待文件夹窗口置于前台超时'));
    }, 15000);
    child.stderr?.on('data', chunk => { detail = (detail + chunk.toString('utf8')).slice(-4096); });
    child.once('error', error => { clearTimeout(timer); reject(new Error(`无法启动目录窗口：${error.message}`)); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(detail.trim() || `打开并前置文件夹失败：exit=${String(code)}`));
    });
  });
}
