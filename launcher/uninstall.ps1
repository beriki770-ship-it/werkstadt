# uninstall.ps1 - removes both scheduled tasks, the Desktop shortcut, and kills a
# running kiosk. Does not touch data/, docs/, or anything outside launcher/'s
# own installed artifacts, per the task brief ("Nothing else").

$ErrorActionPreference = 'SilentlyContinue'

Unregister-ScheduledTask -TaskName 'Werkstadt-Server' -Confirm:$false
Write-Output "removed task: Werkstadt-Server"
Unregister-ScheduledTask -TaskName 'Werkstadt-Screensaver' -Confirm:$false
Write-Output "removed task: Werkstadt-Screensaver"
Unregister-ScheduledTask -TaskName 'Werkstadt-Restart' -Confirm:$false
Write-Output "removed task: Werkstadt-Restart"

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Werkstadt.lnk'
if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Output "removed shortcut: $shortcutPath"
}

# Kill any kiosk browser window pointed at the Werkstadt page. Matched on the
# command line (kiosk-profile is unique to this launcher) so a normal browser
# window Beri has open is never touched.
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |
  Where-Object { $_.CommandLine -match 'kiosk-profile' } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
    Write-Output "killed kiosk process pid $($_.ProcessId)"
  }

Write-Output "done"
