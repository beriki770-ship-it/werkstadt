# start-server.ps1 - idempotent launch of werkstadt's server.py, hidden, no console.
# Caller: launcher/open.ps1 (before opening the browser) and the Werkstadt-Server
# scheduled task (at logon), per the task brief's "Autostart" requirement.
#
# Windows PowerShell 5.1 only: no &&, no ternary. Smart App Control is ON, so this
# runs the server via pythonw.exe (a signed system binary already on this PC) - 
# never a downloaded/compiled .exe.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot  # project root = parent of launcher/
$launcher = $PSScriptRoot
$logPath = Join-Path $launcher 'server.log'
$port = 4949

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 's'), $msg
  Add-Content -Path $logPath -Value $line -Encoding UTF8
}

# Rotate the log at 5 MB so a long-running server never grows it unbounded.
if (Test-Path $logPath) {
  $size = (Get-Item $logPath).Length
  if ($size -gt 5MB) {
    $old = Join-Path $launcher 'server.log.old'
    Remove-Item -Path $old -Force -ErrorAction SilentlyContinue
    Rename-Item -Path $logPath -NewName 'server.log.old' -Force
  }
}

# Already listening on 4949? Nothing to do - server.py serves this same folder
# whoever started it, per RUNBOOK.md.
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Log "port $port already listening (pid $($listening[0].OwningProcess)) - nothing to start"
  exit 0
}

$pythonw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $pythonw) {
  Write-Log "ERROR: pythonw.exe not found on PATH"
  exit 1
}

$serverScript = Join-Path $root 'server.py'
# No --vault here on purpose: config.json is where the vault path lives, and a
# flag in the autostart script would silently outrank whatever is in the file.
# Quote the script path explicitly - Start-Process does not auto-quote array
# elements that contain spaces.
$argList = @("`"$serverScript`"", '--port', $port)

# pythonw.exe has no console, so sys.stdout/sys.stderr are None unless the
# process's standard handles are explicitly redirected -- server.py now
# guards its own logging against that (RotatingFileHandler at
# launcher/server.log, print() replaced with logging), but redirecting here
# too gives a valid stdout/stderr from the OS side, which is what actually
# stopped the request-thread crash root-caused in docs/HANDOFF.md 2026-09-06.
# Two separate files, not launcher/server.log itself: Start-Process refuses
# identical -RedirectStandardOutput/-RedirectStandardError paths, and
# server.py's own RotatingFileHandler already owns that file continuously
# while the server runs.
$stdoutLog = Join-Path $launcher 'server-stdout.log'
$stderrLog = Join-Path $launcher 'server-stderr.log'

try {
  $proc = Start-Process -FilePath $pythonw -ArgumentList $argList -WorkingDirectory $root `
    -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
  Write-Log "started server.py (pid $($proc.Id)) on port $port, vault=$vault"
}
catch {
  Write-Log "ERROR: failed to start server.py - $_"
  exit 1
}
