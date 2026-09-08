# install.ps1 - one-time setup: generates the icon, creates the Desktop shortcut,
# and registers the two logon scheduled tasks (server autostart + screensaver
# watcher). Re-run any time; every step here is idempotent.
# Caller: run by hand once per machine setup (this is the task brief's items 3+4).

$ErrorActionPreference = 'Stop'
$launcher = $PSScriptRoot
$root = Split-Path -Parent $launcher
$user = $env:USERNAME # whoever is installing it - never a hard-coded account name

# --- 1. icon -----------------------------------------------------------------
$icoPath = Join-Path $launcher 'werkstadt.ico'
if (-not (Test-Path $icoPath)) {
  $python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
  if ($python) {
    & $python (Join-Path $launcher 'make_icon.py')
  }
  else {
    Write-Warning "python.exe not found - shortcut will use the default PowerShell icon"
  }
}

# --- 2. Desktop shortcut -------------------------------------------------------
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Werkstadt.lnk'
$openScript = Join-Path $launcher 'open.ps1'
$powershellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellExe
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$openScript`""
$shortcut.WorkingDirectory = $root
if (Test-Path $icoPath) { $shortcut.IconLocation = $icoPath }
$shortcut.Description = 'Open the Werkstadt city'
$shortcut.Save()
Write-Output "shortcut: $shortcutPath"

# --- 3. Scheduled tasks --------------------------------------------------------
$restartSettings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0)
$plainSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 0)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user

function Install-HiddenTask($name, $scriptPath, $settings, $taskTrigger) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  $action = New-ScheduledTaskAction -Execute $powershellExe `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
  if ($taskTrigger) {
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $taskTrigger -Settings $settings `
      -Description "Werkstadt - $name" | Out-Null
  }
  else {
    Register-ScheduledTask -TaskName $name -Action $action -Settings $settings `
      -Description "Werkstadt - $name" | Out-Null
  }
  Write-Output "registered task: $name"
}

Install-HiddenTask -name 'Werkstadt-Server' -scriptPath (Join-Path $launcher 'start-server.ps1') -settings $restartSettings -taskTrigger $trigger
Install-HiddenTask -name 'Werkstadt-Screensaver' -scriptPath (Join-Path $launcher 'screensaver-watch.ps1') -settings $plainSettings -taskTrigger $trigger
# On demand only, no trigger - "schtasks /Run /TN Werkstadt-Restart" is the documented
# way to reload server.py onto new code (see docs/HANDOFF.md "schtasks /End does nothing").
Install-HiddenTask -name 'Werkstadt-Restart' -scriptPath (Join-Path $launcher 'restart-server.ps1') -settings $plainSettings -taskTrigger $null

Write-Output "done"
