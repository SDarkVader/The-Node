param(
  [Parameter(Mandatory=$true)][string]$TypeScriptRoot,
  [Parameter(Mandatory=$true)][string]$BaselineRepository,
  [Parameter(Mandatory=$true)][string]$BuildDirectory
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $TypeScriptRoot 'typescript\bin\tsc'
$types = Join-Path $TypeScriptRoot '@types'
$build = Join-Path $BuildDirectory 'participant'
$baseline = Join-Path $BuildDirectory 'baseline'
$savedBuild = $env:PARTICIPANT_BUILD
$savedBaseline = $env:PARTICIPANT_BASELINE
$savedBroker = $env:BROKER_RECOVERY_BUILD
try {
  & node $compiler --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --skipLibCheck --types node --typeRoots $types --outDir $build "$repoRoot\src\agent\host.ts" "$repoRoot\src\agent\httpBody.ts"
  if ($LASTEXITCODE -ne 0) { throw 'Integration compilation failed' }
  & node $compiler --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --skipLibCheck --types node --typeRoots $types --outDir $baseline "$BaselineRepository\src\world\world.ts"
  if ($LASTEXITCODE -ne 0) { throw 'Baseline compilation failed' }
  Set-Content -LiteralPath (Join-Path $build 'package.json') -Value '{"type":"module"}'
  Set-Content -LiteralPath (Join-Path $baseline 'package.json') -Value '{"type":"module"}'
  $env:PARTICIPANT_BUILD = (Resolve-Path -LiteralPath $build).Path
  $env:PARTICIPANT_BASELINE = (Resolve-Path -LiteralPath $baseline).Path
  $env:BROKER_RECOVERY_BUILD = $env:PARTICIPANT_BUILD
  & node --test --test-isolation=none "$repoRoot\test\brokerRecovery.test.mjs" "$repoRoot\test\participantIntegration.test.mjs"
  if ($LASTEXITCODE -ne 0) { throw 'Offline integration verification failed' }
} finally {
  $env:PARTICIPANT_BUILD = $savedBuild
  $env:PARTICIPANT_BASELINE = $savedBaseline
  $env:BROKER_RECOVERY_BUILD = $savedBroker
}
