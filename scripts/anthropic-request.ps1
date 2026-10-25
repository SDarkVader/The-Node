# Anthropic Messages worker: the same contract as initial-test-request.ps1, for api.anthropic.com.
# Reads ANTHROPIC_API_KEY from the approved credential file; the key never enters Node, the
# command line or any written file. Sends <ArtifactDirectory>/request.json unchanged, archives the
# response, and writes network.json. No retries, no redirects, 12 s timeout.
# -Endpoint messages      POST /v1/messages              (paid)
# -Endpoint count_tokens  POST /v1/messages/count_tokens (free, rate limited)
param([Parameter(Mandatory=$true)][string]$KeyPath, [Parameter(Mandatory=$true)][string]$ArtifactDirectory,
      [Parameter(Mandatory=$true)][ValidateSet('messages', 'count_tokens')][string]$Endpoint, [switch]$ArchiveAllResponses,
      [ValidateRange(32768,95000)][int]$MaxRequestBytes = 32768)
# Historical context is replay-only. No credential or request file is read past this gate.
throw 'legacy_live_context_security_gate_closed: a paid adapter must use the society information boundary; use npm run society -- --interactive --ticks 3 for supervised local play'
$ErrorActionPreference = 'Stop'
$keyValue = $null
$credentialText = $null
$keyLines = $null
$handler = $null
$client = $null
$request = $null
$response = $null
$result = [ordered]@{ endpoint = $Endpoint; httpStatus = $null; elapsedMs = $null; outcome = 'not_started'; errorType = $null; errorMessage = $null; transportError = $null; requestId = $null }
$watch = [Diagnostics.Stopwatch]::new()
try {
  $file = Get-Item -LiteralPath $KeyPath
  if ($file.Length -gt 16384 -or $file.LinkType) { throw 'credential_file_invalid' }
  $credentialText = [IO.File]::ReadAllText($KeyPath)
  $keyLines = @($credentialText -split '\r?\n' | Where-Object { $_ -match '^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=' })
  if ($keyLines.Count -ne 1) { throw 'credential_entry_invalid' }
  $keyValue = $keyLines[0].Substring($keyLines[0].IndexOf('=') + 1).Trim()
  if (($keyValue.StartsWith('"') -and $keyValue.EndsWith('"')) -or ($keyValue.StartsWith("'") -and $keyValue.EndsWith("'"))) { $keyValue = $keyValue.Substring(1, $keyValue.Length - 2) }
  if ($keyValue.Length -gt 512 -or $keyValue -notmatch '^sk-ant-[A-Za-z0-9_-]{8,}$') { throw 'credential_entry_invalid' }
  $credentialText = $null
  $keyLines = $null
  $body = [IO.File]::ReadAllText((Join-Path $ArtifactDirectory 'request.json'))
  if ([Text.Encoding]::UTF8.GetByteCount($body) -gt $MaxRequestBytes) { throw 'request_bounds' }
  $url = if ($Endpoint -eq 'messages') { 'https://api.anthropic.com/v1/messages' } else { 'https://api.anthropic.com/v1/messages/count_tokens' }
  $handler = [Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $handler.MaxResponseHeadersLength = 16
  $handler.AutomaticDecompression = [Net.DecompressionMethods]::None
  $client = [Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(12)
  $client.MaxResponseContentBufferSize = 262144
  $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, $url)
  [void]$request.Headers.TryAddWithoutValidation('x-api-key', $keyValue)
  [void]$request.Headers.TryAddWithoutValidation('anthropic-version', '2023-06-01')
  $request.Headers.Accept.ParseAdd('application/json')
  $request.Content = [Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'application/json')
  $result.outcome = if ($Endpoint -eq 'messages') { 'dispatching_cost_unknown' } else { 'dispatching_free_count' }
  [IO.File]::WriteAllText((Join-Path $ArtifactDirectory 'network.json'), ($result | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  $watch.Start()
  $response = $client.SendAsync($request).GetAwaiter().GetResult()
  $watch.Stop()
  $result.httpStatus = [int]$response.StatusCode
  $result.outcome = 'http_response'
  $requestIds = $null
  if ($response.Headers.TryGetValues('request-id', [ref]$requestIds)) {
    $candidate = @($requestIds)[0]
    if ($candidate -match '^req_[A-Za-z0-9_-]{1,128}$') { $result.requestId = $candidate }
  }
  $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if ($raw.Contains($keyValue)) { throw 'unsafe_response' }
  if ($ArchiveAllResponses) {
    [IO.File]::WriteAllText((Join-Path $ArtifactDirectory 'response.json'), $raw, [Text.UTF8Encoding]::new($false))
  }
  if ($response.IsSuccessStatusCode) {
    $parsed = $raw | ConvertFrom-Json -Depth 40
    if ($Endpoint -eq 'messages' -and $parsed.type -ne 'message') { throw 'response_envelope' }
    if ($Endpoint -eq 'count_tokens' -and $null -eq $parsed.input_tokens) { throw 'response_envelope' }
    [IO.File]::WriteAllText((Join-Path $ArtifactDirectory 'response.json'), $raw, [Text.UTF8Encoding]::new($false))
    $result.outcome = 'response_archived'
  } else {
    # Anthropic errors: {"type":"error","error":{"type":"invalid_request_error","message":"..."}}.
    # The message is kept (bounded) because it names a rejected schema keyword; it never holds the key.
    try {
      $parsed = $raw | ConvertFrom-Json -Depth 20
      $type = [string]$parsed.error.type
      if ($type -match '^[a-z_]{1,80}$') { $result.errorType = $type }
      $message = [string]$parsed.error.message
      if ($message.Length -gt 0) { $result.errorMessage = $message.Substring(0, [Math]::Min(400, $message.Length)) }
    } catch {}
  }
  $raw = $null
  $parsed = $null
} catch {
  $result.outcome = if ($null -eq $result.httpStatus) { 'transport_or_local_error' } else { 'response_processing_error' }
  $failure = $_.Exception.GetBaseException()
  $result.transportError = $failure.GetType().Name
} finally {
  $watch.Stop()
  $result.elapsedMs = $watch.ElapsedMilliseconds
  if ($null -ne $request) { $request.Dispose() }
  if ($null -ne $response) { $response.Dispose() }
  if ($null -ne $client) { $client.Dispose() } elseif ($null -ne $handler) { $handler.Dispose() }
  $keyValue = $null
  $credentialText = $null
  $keyLines = $null
}
[IO.File]::WriteAllText((Join-Path $ArtifactDirectory 'network.json'), ($result | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
