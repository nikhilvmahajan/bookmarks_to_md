<#
.SYNOPSIS
  Registers (or removes) the "Twitter Bookmarks Sync" scheduled task.

.DESCRIPTION
  Triggers at logon with a delay, then repeats on an interval so the backlog
  drains a batch at a time. Battery/AC gating lives in run-fetch.ps1, not in the
  task conditions, because Task Scheduler has no battery-percentage condition,
  so the task is deliberately allowed to start on battery.

  NOTE: keep this file ASCII-only (see run-fetch.ps1 for why).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1 -IntervalMinutes 30
  powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1 -Uninstall
#>
param(
  [string]$TaskName = 'Twitter Bookmarks Sync',
  [int]$IntervalMinutes = 15,
  [int]$StartDelayMinutes = 2,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repoRoot  = Split-Path -Parent $PSScriptRoot
$runScript = Join-Path $PSScriptRoot 'run-fetch.ps1'

if ($Uninstall) {
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    Write-Host "Removed scheduled task '$TaskName'."
  } catch {
    Write-Host "No scheduled task named '$TaskName' found."
  }
  exit 0
}

if (-not (Test-Path $runScript)) { throw "Missing $runScript" }

$action = New-ScheduledTaskAction `
  -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runScript`"" `
  -WorkingDirectory $repoRoot

$userId = "$env:USERDOMAIN\$env:USERNAME"

# At logon, then repeat indefinitely. The repetition block has to be borrowed
# from a -Once trigger; New-ScheduledTaskTrigger will not build one on -AtLogOn.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$trigger.Delay = "PT${StartDelayMinutes}M"

$repeating = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$trigger.Repetition = $repeating.Repetition

# AllowStartIfOnBatteries / DontStopIfGoingOnBatteries are required: without them
# Windows applies its own AC-only policy and the >50% rule in run-fetch.ps1 never runs.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Fetches new Twitter/X bookmarks and saves them as Markdown files.' `
  -Force | Out-Null

Write-Host "Registered '$TaskName':"
Write-Host "  at logon (+$StartDelayMinutes min delay), then every $IntervalMinutes minutes"
Write-Host "  runs: $runScript"
Write-Host "  log:  $(Join-Path $repoRoot 'logs\sync.log')"
Write-Host ""
Write-Host "Run it now:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Remove it:   .\scripts\install-task.ps1 -Uninstall"
