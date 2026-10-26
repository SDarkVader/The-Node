# Build the existing Godot scene for inclusion in the Observatory. No provider access.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Godot,
  [Parameter(Mandatory = $true)][string]$WebTemplate,
  [string]$OutputDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Get-NodeFileSha256([string]$Path) {
  # .NET is available in both Windows PowerShell and PowerShell 7, including when
  # a parent process supplies module paths for a different PowerShell installation.
  $nodeHashStream = [IO.File]::OpenRead($Path)
  $nodeHashAlgorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($nodeHashAlgorithm.ComputeHash($nodeHashStream)).Replace('-', '').ToLowerInvariant() }
  finally { $nodeHashAlgorithm.Dispose(); $nodeHashStream.Dispose() }
}
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $repositoryRoot '.codex/godot-web' }
$target = [IO.Path]::GetFullPath($OutputDirectory)
$engine = (Resolve-Path -LiteralPath $Godot).Path
$template = (Resolve-Path -LiteralPath $WebTemplate).Path
$revision = (& git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot pin the renderer source.' }
$version = (& $engine --version | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^4\.') { throw 'Godot 4 is required.' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
$project = Join-Path $target ('source-' + $revision)
New-Item -ItemType Directory -Path $project -Force | Out-Null
foreach ($name in @('project.godot', 'scripts', 'scenes')) {
  Copy-Item -LiteralPath (Join-Path $repositoryRoot ('client/' + $name)) -Destination $project -Recurse -Force
}
$presets = Join-Path $project 'export_presets.cfg'
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'client/observatory_web_export.cfg') -Destination $presets -Force
$source = [IO.File]::ReadAllText($presets)
$source = $source.Replace('custom_template/release=""', ('custom_template/release="' + $template.Replace('\', '/') + '"'))
[IO.File]::WriteAllText($presets, $source, (New-Object Text.UTF8Encoding($false)))
$log = Join-Path $target 'build.log'
& $engine --headless --path $project --export-release 'Observatory Web' (Join-Path $target 'index.html') 2>&1 | Out-File -LiteralPath $log -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw ('Godot export failed. See ' + $log) }
$files = @('index.html', 'index.js', 'index.wasm', 'index.pck')
foreach ($name in $files) { if (-not [IO.File]::Exists((Join-Path $target $name))) { throw ('Missing Godot output: ' + $name) } }
$manifest = @{ format='node-godot-web-build-v1'; sourceRevision=$revision; engineVersion=$version;
  templateSha256=(Get-NodeFileSha256 $template);
  files=@($files | ForEach-Object { @{name=$_;sha256=(Get-NodeFileSha256 (Join-Path $target $_))} }) }
[IO.File]::WriteAllText((Join-Path $target 'build.json'), ($manifest | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
Write-Output ($manifest | ConvertTo-Json -Depth 5)
