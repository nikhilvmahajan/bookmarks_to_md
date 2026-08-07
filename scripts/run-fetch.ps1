<#
.SYNOPSIS
  Unattended Twitter bookmarks sync. Runs one batch, then exits.

.DESCRIPTION
  Invoked by the "Twitter Bookmarks Sync" scheduled task. Windows Task Scheduler
  can gate on AC power but has no battery-percentage condition, so the power rule
  (on AC, OR battery above the threshold) is enforced here instead.

  Batch size, output directory and battery threshold all come from
  .bookmarks-config.json, so they can change without touching the task:
    node src\cli.js config --batch-size 50 --battery-threshold 30

  NOTE: keep this file ASCII-only. PowerShell 5.1 reads a BOM-less file as ANSI,
  so UTF-8 punctuation (em dashes, curly quotes) turns into stray quote bytes and
  breaks parsing.
#>
param(
  [int]$BatteryThreshold = -1,
  [switch]$IgnorePower
)

$ErrorActionPreference = 'Stop'
$repoRoot   = Split-Path -Parent $PSScriptRoot
$logDir     = Join-Path $repoRoot 'logs'
$logFile    = Join-Path $logDir 'sync.log'
$configPath = Join-Path $repoRoot '.bookmarks-config.json'

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

# Keep the log from growing without bound.
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
  $keep = Get-Content $logFile -Tail 2000
  Set-Content -Path $logFile -Value $keep -Encoding utf8
}

# An explicit -BatteryThreshold wins; otherwise take it from config, else 50.
if ($BatteryThreshold -lt 0) {
  $BatteryThreshold = 50
  if (Test-Path $configPath) {
    try {
      $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
      if ($null -ne $cfg.batteryThreshold) { $BatteryThreshold = [int]$cfg.batteryThreshold }
    } catch {
      Write-Log 'Could not read batteryThreshold from config; using 50.' 'WARN'
    }
  }
}

# Returns $true when on AC power, or on battery above the threshold.
# A machine with no battery (desktop) is always considered fine.
function Test-PowerOk {
  param([int]$Threshold)

  $batteries = @()
  try { $batteries = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop) } catch { }

  if ($batteries.Count -eq 0) {
    Write-Log 'No battery detected - treating as AC power.'
    return $true
  }

  # Win32_Battery.BatteryStatus: 1 = discharging, 4 = low, 5 = critical.
  # Every other value means the system has access to AC.
  $onBattery = $true
  foreach ($b in $batteries) {
    if ($b.BatteryStatus -notin @(1, 4, 5)) { $onBattery = $false }
  }
  if (-not $onBattery) {
    Write-Log 'On AC power.'
    return $true
  }

  $pct = ($batteries | Measure-Object -Property EstimatedChargeRemaining -Maximum).Maximum
  if ($null -ne $pct -and $pct -gt $Threshold) {
    Write-Log "On battery at $pct% (threshold $Threshold%) - proceeding."
    return $true
  }

  Write-Log "On battery at $pct% (threshold $Threshold%) - skipping this run."
  return $false
}

if ($IgnorePower) {
  Write-Log 'Power check bypassed (-IgnorePower).'
} elseif (-not (Test-PowerOk -Threshold $BatteryThreshold)) {
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $fallback = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $fallback) { $node = $fallback }
}
if (-not $node) {
  Write-Log 'node.exe not found on PATH - cannot run sync.' 'ERROR'
  exit 1
}

$cli = Join-Path $repoRoot 'src\cli.js'

Write-Log 'Starting bookmark sync batch'

$outFile = Join-Path $env:TEMP 'btm-sync.out'
$errFile = Join-Path $env:TEMP 'btm-sync.err'

$proc = Start-Process -FilePath $node `
  -ArgumentList @("`"$cli`"") `
  -WorkingDirectory $repoRoot `
  -NoNewWindow -Wait -PassThru `
  -RedirectStandardOutput $outFile `
  -RedirectStandardError $errFile

$code = $proc.ExitCode

foreach ($file in @($outFile, $errFile)) {
  if (Test-Path $file) {
    foreach ($line in (Get-Content $file -Encoding UTF8)) {
      $text = "$line".TrimEnd()
      if ($text) { Write-Log "  $text" }
    }
    Remove-Item $file -Force -ErrorAction SilentlyContinue
  }
}

if ($code -eq 2) {
  Write-Log 'Twitter session expired. Update tokens: node src\cli.js config --auth-token <v> --ct0 <v>' 'ERROR'
} elseif ($code -ne 0) {
  Write-Log "Exited with code $code" 'ERROR'
} else {
  Write-Log 'Batch complete'
}

# Rate limiting is handled gracefully in the CLI (saves progress and exits 0).
# Auth failure (exit 2) is the only code worth propagating.
exit $code
