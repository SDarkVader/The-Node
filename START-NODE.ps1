# Standalone PC launcher. No Codex, Work or active chat session is required.
# Preview: powershell -NoProfile -File .\START-NODE.ps1
# Real agents: powershell -NoProfile -File .\START-NODE.ps1 -Start -Ticks 1
# Keep this terminal running. A real run requires your fresh review and START confirmation.
[CmdletBinding()]
param(
  [switch]$Start,
  [ValidateRange(1,20)][int]$Ticks = 1,
  [int]$Seed = 42,
  [string]$Settings = (Join-Path $env:LOCALAPPDATA 'The-Node/test.local.json'),
  [switch]$NoBrowser
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$nodeLauncher = Join-Path $PSScriptRoot 'scripts/start-node-test.ps1'
& $nodeLauncher -Ticks $Ticks -Seed $Seed -Settings $Settings -Start:$Start -NoBrowser:$NoBrowser
