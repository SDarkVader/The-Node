param([Parameter(Mandatory=$true)][string]$KeyPath, [Parameter(Mandatory=$true)][string]$ArtifactDirectory)
$ErrorActionPreference = 'Stop'
$keyValue = $null
$credentialText = $null
$keyLines = $null
$handler = $null
$client = $null
$request = $null
$response = $null
$result = [ordered]@{ httpStatus = $null; elapsedMs = $null; outcome = 'not_started'; errorCode = $null; transportError = $null; requestId = $null }
$watch = [Diagnostics.Stopwatch]::new()
try {
  $file = Get-Item -LiteralPath $keyPath
  if ($file.Length -gt 16384 -or $file.LinkType) { throw 'credential_file_invalid' }
  $credentialText = [IO.File]::ReadAllText($keyPath)
  $keyLines = @($credentialText -split '\r?\n' | Where-Object { $_ -match '^\s*(?:export\s+)?OPENAI_API_KEY\s*=' })
  if ($keyLines.Count -ne 1) { throw 'credential_entry_invalid' }
  $keyValue = $keyLines[0].Substring($keyLines[0].IndexOf('=') + 1).Trim()
  if (($keyValue.StartsWith('"') -and $keyValue.EndsWith('"')) -or ($keyValue.StartsWith("'") -and $keyValue.EndsWith("'"))) { $keyValue = $keyValue.Substring(1, $keyValue.Length - 2) }
  if ($keyValue.Length -gt 512 -or $keyValue -notmatch '^sk-[A-Za-z0-9_-]{8,}$') { throw 'credential_entry_invalid' }
  $credentialText = $null
  $keyLines = $null
  $body = [IO.File]::ReadAllText((Join-Path $ArtifactDirectory 'request.json'))
  if ([Text.Encoding]::UTF8.GetByteCount($body) -gt 32768) { throw 'request_bounds' }
  $handler = [Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $handler.MaxResponseHeadersLength = 16
  $handler.AutomaticDecompression = [Net.DecompressionMethods]::None
  $client = [Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(12)
  $client.MaxResponseContentBufferSize = 262144
  $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, 'https://api.openai.com/v1/responses')
  $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $keyValue)
  $request.Headers.Accept.ParseAdd('application/json')
  $request.Content = [Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'application/json')
  $result.outcome = 'dispatching_cost_unknown'
  [IO.File]::WriteAllText((Join-Path $ArtifactDirectory 'network.json'), ($result | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  $watch.Start()
  $response = $client.SendAsync($request).GetAwaiter().GetResult()
  $watch.Stop()
  $result.httpStatus = [int]$response.StatusCode
  $result.outcome = 'http_response'
  $requestIds = $null
  if ($response.Headers.TryGetValues('x-request-id', [ref]$requestIds)) {
    $candidate = @($requestIds)[0]
    if ($candidate -match '^req_[A-Za-z0-9_-]{1,128}$') { $result.requestId = $candidate }
  }
  $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if ($response.IsSuccessStatusCode) {
    if ($raw.Contains($keyValue)) { throw 'unsafe_response' }
    $parsed = $raw | ConvertFrom-Json -Depth 40
    if ($parsed.object -ne 'response') { throw 'response_envelope' }
    [IO.File]::WriteAllText((Join-Path $ArtifactDirectory 'response.json'), $raw, [Text.UTF8Encoding]::new($false))
    $result.outcome = 'response_archived'
  } else {
    try {
      $parsed = $raw | ConvertFrom-Json -Depth 20
      $code = [string]$parsed.error.code
      if ($code -match '^[A-Za-z0-9_-]{1,80}$' -and -not $code.StartsWith('sk-')) { $result.errorCode = $code }
    } catch {}
  }
  $raw = $null
  $parsed = $null
} catch {
  $result.outcome = if ($null -eq $result.httpStatus) { 'transport_or_local_error_cost_unknown' } else { 'response_processing_error' }
  $failure = $_.Exception.GetBaseException()
  $result.transportError = $failure.GetType().Name
} finally {
  $watch.Stop()
  $result.elapsedMs = $watch.ElapsedMilliseconds
  if ($null -ne $request) { $request.Headers.Authorization = $null; $request.Dispose() }
  if ($null -ne $response) { $response.Dispose() }
  if ($null -ne $client) { $client.Dispose() } elseif ($null -ne $handler) { $handler.Dispose() }
  $keyValue = $null
  $credentialText = $null
  $keyLines = $null
}
[IO.File]::WriteAllText((Join-Path $ArtifactDirectory 'network.json'), ($result | ConvertTo-Json), [Text.UTF8Encoding]::new($false))

