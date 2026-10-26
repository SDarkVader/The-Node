# Human-started real-agent playtest. Preparation and checks make no provider calls.
[CmdletBinding(DefaultParameterSetName = 'Prepare')]
param(
  [Parameter(Mandatory = $true, ParameterSetName = 'Prepare')][string]$PriorJournal,
  [Parameter(Mandatory = $true, ParameterSetName = 'Prepare')][string]$CredentialFile,
  [Parameter(Mandatory = $true, ParameterSetName = 'Prepare')][string]$OutputRoot,
  [Parameter(Mandatory = $true, ParameterSetName = 'Prepare')][string]$PostcardRate,
  [Parameter(ParameterSetName = 'Prepare')][long]$PostcardStartMs = 0,
  [Parameter(ParameterSetName = 'Prepare')][ValidateRange(1, 20)][int]$Ticks = 3,
  [Parameter(ParameterSetName = 'Prepare')][int]$Seed = 42,
  [Parameter(Mandatory = $true, ParameterSetName = 'Review')][string]$Review,
  [Parameter(ParameterSetName = 'Review')][switch]$CheckOnly,
  [Parameter(ParameterSetName = 'Review')][switch]$ApprovePaidRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($CheckOnly -and $ApprovePaidRun) { throw 'Choose CheckOnly or ApprovePaidRun, not both.' }
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodeExecutable = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$nodeMajor = & $nodeExecutable -p 'parseInt(process.versions.node)'
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) { throw 'Node 24 or newer is required.' }
Push-Location -LiteralPath $repositoryRoot
try {
  if ($PSCmdlet.ParameterSetName -eq 'Prepare') {
    $raw = & $nodeExecutable --import tsx scripts/prepare-society-playtest.ts --prepare `
      --prior-journal $PriorJournal --credential $CredentialFile --output $OutputRoot `
      --postcard-rate $PostcardRate --postcard-start-ms $PostcardStartMs --ticks $Ticks --seed $Seed
    if ($LASTEXITCODE -ne 0) { throw 'Playtest preparation failed. Preserve any new files and inspect the error; no live call was made.' }
    $result = ($raw -join "`n") | ConvertFrom-Json
    $raw | Write-Output
    Write-Host 'Review the source, clock, call and spending bounds above. This has not approved or started a run.'
    Write-Host ('To start this exact reviewed test: powershell -NoProfile -File "{0}" -Review "{1}" -ApprovePaidRun' -f $PSCommandPath, $result.review)
    return
  }
  $reviewPath = (Resolve-Path -LiteralPath $Review).Path
  if (-not $ApprovePaidRun) {
    & $nodeExecutable --import tsx scripts/prepare-society-playtest.ts --check --review $reviewPath
    if ($LASTEXITCODE -ne 0) { throw 'Playtest checks failed. No live call was made.' }
    return
  }
  $raw = & $nodeExecutable --import tsx scripts/prepare-society-playtest.ts --approve --review $reviewPath
  if ($LASTEXITCODE -ne 0) { throw 'Playtest approval failed. Do not retry automatically; inspect the private review directory.' }
  $approved = ($raw -join "`n") | ConvertFrom-Json
  $raw | Write-Output
  # The reviewed existing launcher carries accounting, parses a private credential copy,
  # starts the fixed worker, retains raw/partial evidence and removes only its key copy.
  & (Join-Path $PSScriptRoot 'start-society-live.ps1') -Config $approved.launch
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
