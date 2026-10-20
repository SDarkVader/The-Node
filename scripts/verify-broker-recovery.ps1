param(
  [Parameter(Mandatory=$true)][string]$TypeScriptRoot,
  [Parameter(Mandatory=$true)][string]$BuildDirectory
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $TypeScriptRoot 'typescript\bin\tsc'
$typeRoots = Join-Path $TypeScriptRoot '@types'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Provide an existing node_modules directory containing TypeScript and @types/node. No packages will be downloaded.' }
$previousBuild = $env:BROKER_RECOVERY_BUILD
try {
  & node $compiler --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --skipLibCheck --types node --typeRoots $typeRoots --outDir $BuildDirectory "$repoRoot\src\agent\broker.ts" "$repoRoot\src\agent\httpBody.ts"
  if ($LASTEXITCODE -ne 0) { throw 'Reconstruction typecheck failed' }
  Set-Content -LiteralPath (Join-Path $BuildDirectory 'package.json') -Value '{"type":"module"}'
  $env:BROKER_RECOVERY_BUILD = (Resolve-Path -LiteralPath $BuildDirectory).Path
  & node --test --test-isolation=none "$repoRoot\test\brokerRecovery.test.mjs"
  if ($LASTEXITCODE -ne 0) { throw 'Reconstruction tests failed' }
} finally {
  $env:BROKER_RECOVERY_BUILD = $previousBuild
}
