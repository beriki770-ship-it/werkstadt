# open.ps1 - the Desktop shortcut's target. Starts the server if needed, waits for
# it to answer, then opens the city in the default browser.
# Caller: the "Werkstadt" .lnk shortcut created by launcher/install.ps1.

$ErrorActionPreference = 'Stop'
$launcher = $PSScriptRoot

& (Join-Path $launcher 'start-server.ps1')

$healthUrl = 'http://127.0.0.1:4949/api/sessions'
$deadline = (Get-Date).AddSeconds(10)
$up = $false
while ((Get-Date) -lt $deadline) {
  try {
    $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $up = $true; break }
  }
  catch {
    Start-Sleep -Milliseconds 300
  }
}

# settings.json's "page" picks the top-level launcher page - "globe" (default),
# "world" or "city" (index.html?live=1). Whatever it picks is still probed for
# a real 200 first and falls back down the chain if a later page isn't built yet.
$settingsPath = Join-Path $launcher 'settings.json'
$page = 'globe'
if (Test-Path $settingsPath) {
  try {
    $cfg = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($cfg.page) { $page = $cfg.page }
  }
  catch { }
}

$chain = @('globe.html', 'world.html')
if ($page -eq 'world') { $chain = @('world.html') }
elseif ($page -ne 'globe') { $chain = @() }

$target = 'http://127.0.0.1:4949/index.html?live=1'
foreach ($candidatePage in $chain) {
  $candidate = "http://127.0.0.1:4949/$candidatePage"
  try {
    $check = Invoke-WebRequest -Uri $candidate -UseBasicParsing -TimeoutSec 3
    if ($check.StatusCode -eq 200) { $target = $candidate; break }
  }
  catch { }
}

Start-Process $target
