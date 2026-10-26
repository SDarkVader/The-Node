# Launch the reviewed society run directly from PowerShell. Work does not need to remain open.
# The private config pins the source, plan, prior journal, financial ceiling and approval.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Config,
  [switch]$CheckOnly,
  [string]$WebWorld,
  [string]$History,
  [switch]$WithoutInterface
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$configPath = (Resolve-Path -LiteralPath $Config).Path
$nodeExecutable = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$nodeMajor = & $nodeExecutable -p 'parseInt(process.versions.node)'
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) { throw 'Node 24 or newer is required.' }
$runExitCode = 1
$createdCredential = $null
Push-Location -LiteralPath $repositoryRoot
try {
  if (-not $CheckOnly -and -not $WithoutInterface) {
    if ([string]::IsNullOrWhiteSpace($WebWorld)) { $WebWorld=Join-Path $repositoryRoot '.codex/godot-web' }
    if (-not [IO.File]::Exists((Join-Path $WebWorld 'build.json'))) { throw 'Build the embedded Godot renderer with start-node-test.ps1 before spending preparation.' }
  }
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
  $runArguments=@('--import','tsx','scripts/run-society-live.ts','--owner-approved',
    '--bundle',$execution.bundle,'--budget',$execution.budget,'--carried-fingerprint',$execution.carriedFingerprint,
    '--approval',$execution.approval,'--credential',$execution.credential,'--output',$execution.output)
  if (-not $WithoutInterface) {
    $runArguments+=@('--observatory','--manual-ticks','--web-world',$WebWorld)
    if (-not [string]::IsNullOrWhiteSpace($History)) { $runArguments+=@('--history',$History) }
  }
  & $nodeExecutable @runArguments | ForEach-Object {
    $line=$_;Write-Output $line
    try { $event=$line | ConvertFrom-Json } catch { return }
    if ($null -ne $event.PSObject.Properties['event']) {
      if ($event.event -eq 'observatory_ready') {
        Write-Host ('Interface token: '+$event.loginToken)
        Start-Process -FilePath $event.url
      }
      if ($event.event -eq 'society_run_finalized' -and $null -ne $createdCredential -and [IO.File]::Exists($createdCredential)) {
        Remove-Item -LiteralPath $createdCredential -Force
        $createdCredential=$null
      }
    }
  } |
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
