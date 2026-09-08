# restart-server.ps1 - reload server.py onto new code without a manual kill.
# Caller: the Werkstadt-Restart scheduled task ("schtasks /Run /TN Werkstadt-Restart"),
# the documented way to reload code per docs/HANDOFF.md's "schtasks /End does nothing"
# gotcha - /End can't stop a Start-Process-detached pythonw, and /Run is a no-op while
# the port is still listening.
#
# Windows PowerShell 5.1 only: no &&, no ternary. ASCII only.

$ErrorActionPreference = 'Stop'

$launcher = $PSScriptRoot
$root = Split-Path -Parent $launcher
$logPath = Join-Path $launcher 'server.log'
$port = 4949
$apiUrl = "http://127.0.0.1:$port/api/sessions"

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 's'), $msg
  Add-Content -Path $logPath -Value $line -Encoding UTF8
}

function Fail($msg) {
  Write-Log "restart FAILED: $msg"
  Write-Output "restart FAILED: $msg"
  exit 1
}

# --- 1. find and verify the listener --------------------------------------
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  $oldPid = $listening[0].OwningProcess
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$oldPid" -ErrorAction SilentlyContinue
  if (-not $proc) {
    Fail "pid $oldPid is listening on $port but Win32_Process lookup failed - refusing to guess, not killing anything"
  }
  # Never kill anything but this launcher's own server.py, per the task brief.
  $nameOk = ($proc.Name -eq 'pythonw.exe') -or ($proc.Name -eq 'python.exe')
  $cmdOk = ($proc.CommandLine -match 'werkstadt') -and ($proc.CommandLine -match 'server\.py')
  if (-not ($nameOk -and $cmdOk)) {
    Fail "pid $oldPid on port $port is '$($proc.Name)' / '$($proc.CommandLine)' - does not look like werkstadt's server.py, not killing it"
  }

  Write-Log "restart: stopping pid $oldPid ($($proc.Name)) listening on $port"
  Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue

  # --- 2. wait until the port is actually free (<= 5 s) --------------------
  $freed = $false
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 200
    $still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $still) { $freed = $true; break }
  }
  if (-not $freed) {
    Fail "port $port still listening 5 s after Stop-Process on pid $oldPid"
  }
}
else {
  Write-Log "restart: nothing listening on $port - starting fresh"
}

# --- 3. start-server.ps1 does the actual launch ----------------------------
try {
  & (Join-Path $launcher 'start-server.ps1')
}
catch {
  Fail "start-server.ps1 threw - $_"
}

# --- 4. wait for /api/sessions to answer 200 (<= 15 s) ---------------------
$up = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $resp = Invoke-WebRequest -Uri $apiUrl -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $up = $true; break }
  }
  catch {
    # not up yet, or a cold-cache timeout on this endpoint (RUNBOOK.md) - keep polling
  }
}
if (-not $up) {
  Fail "$apiUrl did not answer 200 within 15 s of starting"
}

# --- 5. report the new pid ---------------------------------------------------
$newListening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $newListening) {
  Fail "server answered $apiUrl but port $port is not listening - inconsistent state"
}
$newPid = $newListening[0].OwningProcess
$newProc = Get-Process -Id $newPid -ErrorAction SilentlyContinue
$startedAt = "unknown"
if ($newProc) { $startedAt = Get-Date $newProc.StartTime -Format 's' }

Write-Log "restarted: pid $newPid started $startedAt"
Write-Output "restarted: pid $newPid started $startedAt"
