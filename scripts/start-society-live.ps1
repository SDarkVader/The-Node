# Launch the reviewed society run directly from PowerShell. Work does not need to remain open.
# The private config pins the source, plan, prior journal, financial ceiling and approval.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Config,
  [switch]$CheckOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$configPath = (Resolve-Path -LiteralPath $Config).Path
$nodeExecutable = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$nodeMajor = & $nodeExecutable -p 'Number(process.versions.node.split(".")[0])'
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) { throw 'Node 24 or newer is required.' }
$runExitCode = 1
$createdCredential = $null
Push-Location -LiteralPath $repositoryRoot
try {
  & $nodeExecutable --import tsx scripts/prepare-society-launch.ts --config $configPath --check
  if ($LASTEXITCODE -ne 0) { throw 'Read-only launch checks failed. No live call was made.' }
  if ($CheckOnly) { return }
  $prepared = & $nodeExecutable --import tsx scripts/prepare-society-launch.ts --config $configPath
  if ($LASTEXITCODE -ne 0) { throw 'Launch preparation failed. Inspect the private execution directory; do not retry automatically.' }
  $execution = ($prepared -join "`n") | ConvertFrom-Json
  $settings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $credentialPath = [IO.Path]::GetFullPath([string]$execution.credential)
  $executionRoot = [IO.Path]::GetFullPath([string]$settings.outputRoot)
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($credentialPath), $executionRoot)) {
    throw 'Prepared credential is outside the new execution directory.'
  }
  $createdCredential = $credentialPath
  Write-Host 'Starting the bounded run. Ctrl+C stops it. Do not restart a stopped attempt.'
  & $nodeExecutable --import tsx scripts/run-society-live.ts --owner-approved `
    --bundle $execution.bundle --budget $execution.budget --carried-fingerprint $execution.carriedFingerprint `
    --approval $execution.approval --credential $execution.credential --output $execution.output |
    Tee-Object -FilePath (Join-Path $executionRoot 'console.jsonl')
  $runExitCode = $LASTEXITCODE
  # Export again after finalization, including late errors. Existing raw artifacts stay intact.
  if (Test-Path -LiteralPath $execution.output -PathType Container) {
    & $nodeExecutable --import tsx scripts/export-society-results.ts --raw `
      --input $execution.output --output (Join-Path $executionRoot 'raw-dump')
    if ($LASTEXITCODE -ne 0) { $runExitCode = 1 }
  }
} finally {
  # This is only the new preparer's temporary copy; the original credential is preserved.
  if ($null -ne $createdCredential -and [IO.File]::Exists($createdCredential)) {
    Remove-Item -LiteralPath $createdCredential -Force
  }
  Pop-Location
}
exit $runExitCode
