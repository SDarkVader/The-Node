# One PC entrypoint. Default: model-free manual preview + saved runs. -Start: reviewed real test.
[CmdletBinding()]
param([ValidateRange(1,20)][int]$Ticks=3,[int]$Seed=42,[ValidateRange(1,25)][decimal]$BudgetUsd=1,[switch]$Start,[switch]$NoBrowser,
  [string]$Settings=(Join-Path $env:LOCALAPPDATA 'The-Node/test.local.json'))
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repositoryRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$settingsPath=(Resolve-Path -LiteralPath $Settings).Path
$config=Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$lock=$null
Push-Location -LiteralPath $repositoryRoot
try {
  $lock=[IO.File]::Open(($settingsPath+'.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  $revision=(& git rev-parse HEAD).Trim()
  $manifest=Join-Path $config.webWorldDirectory 'build.json'
  if (-not (Test-Path -LiteralPath $manifest) -or (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).sourceRevision -ne $revision) {
    & (Join-Path $PSScriptRoot 'build-godot-web.ps1') -Godot $config.godot -WebTemplate $config.webTemplate -OutputDirectory $config.webWorldDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Godot build failed before any spending preparation.' }
  }
  if (-not $Start) {
    $arguments=@('--import','tsx','scripts/preview-society.ts','--dual-navigation','--godot',$config.godot,'--ticks',[string]$Ticks,'--seed',[string]$Seed,'--web-world',$config.webWorldDirectory)
    if (Test-Path -LiteralPath $config.historyRegistration) { $arguments+=@('--history',$config.historyRegistration) }
    & node @arguments | ForEach-Object {
      $line=$_;Write-Output $line
      try { $event=$line | ConvertFrom-Json } catch { return }
      if ($null -ne $event.PSObject.Properties['event'] -and $event.event -eq 'observatory_ready') {
        Write-Host ('Interface token: '+$event.loginToken)
        if (-not $NoBrowser) { Start-Process -FilePath $event.url }
      }
    }
    if ($LASTEXITCODE -ne 0) { throw 'Society preview stopped with an error. Inspect the retained run output.' }
    return
  }
  $limitMicroUsd=[int64]($BudgetUsd*1000000)
  $raw=& node --import tsx scripts/manage-node-tests.ts --settings $settingsPath --prepare --ticks $Ticks --seed $Seed --limit-micro-usd $limitMicroUsd
  if ($LASTEXITCODE -ne 0) { throw 'Preparation stopped. Existing evidence and financial history are preserved.' }
  $review=($raw -join "`n") | ConvertFrom-Json
  $raw | Write-Output
  Write-Host 'Real provider test. Manual ticks spend within the reviewed call and USD bounds. Replay spends nothing.'
  $answer=Read-Host 'Type START to approve this exact prepared run'
  if ($answer -cne 'START') { & node --import tsx scripts/manage-node-tests.ts --settings $settingsPath --finish; return }
  try {
    $liveArguments=@{Review=$review.review;ApprovePaidRun=$true;WebWorld=$config.webWorldDirectory;Godot=$config.godot}
    if (Test-Path -LiteralPath $config.historyRegistration) { $liveArguments.History=$config.historyRegistration }
    & (Join-Path $PSScriptRoot 'start-society-playtest.ps1') @liveArguments
  } finally {
    & node --import tsx scripts/manage-node-tests.ts --settings $settingsPath --finish
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Latest run needs inspection. Do not replace its journal with an older copy.' }
  }
} finally { if ($null -ne $lock) { $lock.Dispose() };Pop-Location }
