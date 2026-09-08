# screensaver-watch.ps1 - replaces the Windows screensaver with the Werkstadt
# kiosk page after N idle minutes, and closes it on the first input afterward.
# Caller: the Werkstadt-Screensaver scheduled task (at logon, hidden).
# Runs forever in a loop - the scheduled task starts it once per logon.

$ErrorActionPreference = 'Stop'
$launcher = $PSScriptRoot
$logPath = Join-Path $launcher 'screensaver.log'
$settingsPath = Join-Path $launcher 'settings.json'
$profileDir = Join-Path $launcher 'kiosk-profile'
$fallbackUrl = 'http://127.0.0.1:4949/index.html?live=1&screensaver=1'

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 's'), $msg
  Add-Content -Path $logPath -Value $line -Encoding UTF8
}

function Get-IdleMinutes {
  if (Test-Path $settingsPath) {
    try {
      $cfg = Get-Content $settingsPath -Raw | ConvertFrom-Json
      if ($cfg.idleMinutes) { return [double]$cfg.idleMinutes }
    }
    catch { }
  }
  return 5
}

# Same "page" setting open.ps1 reads - lets a human switch the kiosk page to
# "world" or "city" (index.html?live=1) without editing this script.
function Get-Page {
  if (Test-Path $settingsPath) {
    try {
      $cfg = Get-Content $settingsPath -Raw | ConvertFrom-Json
      if ($cfg.page) { return $cfg.page }
    }
    catch { }
  }
  return 'globe'
}

# P/Invoke GetLastInputInfo - the standard idle-time query, no external tool.
if (-not ([System.Management.Automation.PSTypeName]'Idle.Native').Type) {
  Add-Type -Namespace Idle -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")]
public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
'@
}

function Get-IdleSeconds {
  $lii = New-Object Idle.Native+LASTINPUTINFO
  $lii.cbSize = [uint32][System.Runtime.InteropServices.Marshal]::SizeOf($lii)
  [Idle.Native]::GetLastInputInfo([ref]$lii) | Out-Null
  $idleTicks = [uint32][Environment]::TickCount - $lii.dwTime
  return [double]$idleTicks / 1000.0
}

# A display-power request from some other app (a fullscreen video, a presentation)
# means "do not screensave". `powercfg /requests` needs an elevated shell - the
# scheduled task at logon of a standard user is not elevated, so this check is
# best-effort: on access-denied it logs once and treats it as "no request", same
# as if the check were unavailable. Confirmed on this machine 2026-09-05:
# non-elevated `powercfg /requests` fails with "requires administrator privileges".
$powercfgWarned = $false
function Test-DisplayRequestActive {
  try {
    $out = & powercfg /requests 2>&1
    if ($LASTEXITCODE -ne 0) { throw "powercfg exit $LASTEXITCODE" }
    # Output lists one heading per request type, e.g. "DISPLAY:" followed by
    # either "None." or indented "[PROCESS] \Device\...\app.exe" lines.
    $joined = $out -join "`n"
    if ($joined -match '(?ms)^DISPLAY:\s*\r?\n(.*?)(\r?\n[A-Z]+:|\z)') {
      $body = $Matches[1].Trim()
      return ($body -ne '' -and $body -ne 'None.')
    }
    return $false
  }
  catch {
    if (-not $script:powercfgWarned) {
      Write-Log "powercfg /requests unavailable ($($_.Exception.Message)) - skipping the DISPLAY-request check"
      $script:powercfgWarned = $true
    }
    return $false
  }
}

function Get-BrowserExe {
  $edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
  if (Test-Path $edge) { return @{ Exe = $edge; Name = 'msedge' } }
  $edge2 = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
  if (Test-Path $edge2) { return @{ Exe = $edge2; Name = 'msedge' } }
  $chrome = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
  if (Test-Path $chrome) { return @{ Exe = $chrome; Name = 'chrome' } }
  return $null
}

$kioskProc = $null

function Start-Kiosk {
  if ($script:kioskProc -and -not $script:kioskProc.HasExited) {
    Write-Log "kiosk already running (pid $($script:kioskProc.Id)) - not launching a second one"
    return
  }
  $browser = Get-BrowserExe
  if (-not $browser) {
    Write-Log "ERROR: neither Edge nor Chrome found - cannot start the kiosk"
    return
  }
  # Same globe -> world -> index chain as open.ps1, gated by settings.json's
  # "page" - each candidate is probed for a real 200 before the kiosk launches
  # on it, since globe.html/world.html may not exist yet.
  $page = Get-Page
  $chain = @('globe.html', 'world.html')
  if ($page -eq 'world') { $chain = @('world.html') }
  elseif ($page -ne 'globe') { $chain = @() }

  $url = $fallbackUrl
  foreach ($candidatePage in $chain) {
    try {
      $check = Invoke-WebRequest -Uri "http://127.0.0.1:4949/$candidatePage" -UseBasicParsing -TimeoutSec 2
      if ($check.StatusCode -eq 200) { $url = "http://127.0.0.1:4949/${candidatePage}?screensaver=1"; break }
    }
    catch { }
  }

  if ($browser.Name -eq 'msedge') {
    $args = @("--kiosk", $url, "--edge-kiosk-type=fullscreen", "--new-window", "--user-data-dir=`"$profileDir`"")
  }
  else {
    $args = @("--kiosk", "--app=$url", "--new-window", "--user-data-dir=`"$profileDir`"")
  }
  $script:kioskProc = Start-Process -FilePath $browser.Exe -ArgumentList $args -PassThru
  Write-Log "launched kiosk ($($browser.Name), pid $($script:kioskProc.Id)) at $url"
}

function Stop-Kiosk {
  if ($script:kioskProc -and -not $script:kioskProc.HasExited) {
    Write-Log "input detected - closing kiosk (pid $($script:kioskProc.Id))"
    & taskkill /PID $script:kioskProc.Id /T /F 2>&1 | Out-Null
  }
  $script:kioskProc = $null
}

Write-Log "screensaver watcher started"
while ($true) {
  $idleSeconds = Get-IdleSeconds
  $idleMinutes = Get-IdleMinutes
  $kioskRunning = $script:kioskProc -and -not $script:kioskProc.HasExited

  if (-not $kioskRunning -and $idleSeconds -ge ($idleMinutes * 60)) {
    if (-not (Test-DisplayRequestActive)) {
      Start-Kiosk
    }
  }
  elseif ($kioskRunning -and $idleSeconds -lt 2) {
    Stop-Kiosk
  }

  Start-Sleep -Seconds 5
}
