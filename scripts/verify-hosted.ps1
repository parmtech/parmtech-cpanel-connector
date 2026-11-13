#requires -Version 7.0
param([string]$BaseUrl = 'https://connector.parmtech.au')
$ErrorActionPreference = 'Stop'
$base = [Uri]($BaseUrl.TrimEnd('/') + '/')
if ($base.Scheme -ne 'https' -or $base.UserInfo -or $base.Query -or $base.Fragment -or $base.AbsolutePath -ne '/') {
    throw 'Use an HTTPS origin without credentials, query, fragment or path.'
}
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(20)
$checks = [Collections.Generic.List[object]]::new()
function Check([string]$Name, [bool]$Passed, $Evidence) {
    $checks.Add([pscustomobject]@{test=$Name; result=$(if ($Passed) {'PASS'} else {'FAIL'}); evidence=$Evidence})
}
try {
    $health = $client.GetAsync([Uri]::new($base, 'health')).GetAwaiter().GetResult()
    $body = $health.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    Check 'HTTPS health with normal certificate validation' ($health.StatusCode -eq 200 -and $body.status -eq 'ok') ([int]$health.StatusCode)
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, [Uri]::new($base, 'mcp'))
    $request.Headers.TryAddWithoutValidation('Accept', 'application/json, text/event-stream') | Out-Null
    $request.Content = [Net.Http.StringContent]::new('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"parmtech-verification","version":"1.0"}}}', [Text.Encoding]::UTF8, 'application/json')
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $challenge = $response.Headers.WwwAuthenticate.ToString()
    Check 'Anonymous MCP initialize rejected' ($response.StatusCode -eq 401) ([int]$response.StatusCode)
    $match = [regex]::Match($challenge, 'resource_metadata="([^"]+)"')
    if (!$match.Success) { throw 'Missing protected-resource discovery challenge.' }
    $metadataUri = [Uri]$match.Groups[1].Value
    if ($metadataUri.GetLeftPart([UriPartial]::Authority) -ne $base.GetLeftPart([UriPartial]::Authority)) { throw 'Unexpected discovery origin.' }
    $resourceResponse = $client.GetAsync($metadataUri).GetAwaiter().GetResult()
    $resource = $resourceResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    Check 'Protected-resource metadata' ($resourceResponse.StatusCode -eq 200 -and $resource.resource -eq [Uri]::new($base, 'mcp').AbsoluteUri) $metadataUri.AbsoluteUri
    $oauthResponse = $client.GetAsync([Uri]::new($base, '.well-known/oauth-authorization-server')).GetAwaiter().GetResult()
    $oauth = $oauthResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    $valid = $oauthResponse.StatusCode -eq 200 -and 'S256' -in $oauth.code_challenge_methods_supported -and 'none' -in $oauth.token_endpoint_auth_methods_supported
    foreach ($field in @('issuer','authorization_endpoint','token_endpoint','registration_endpoint','revocation_endpoint')) {
        $uri = [Uri]$oauth.$field
        $valid = $valid -and $uri.GetLeftPart([UriPartial]::Authority) -eq $base.GetLeftPart([UriPartial]::Authority)
    }
    Check 'OAuth same-origin endpoints and PKCE S256' $valid $oauth.issuer
    $admin = $client.GetAsync([Uri]::new($base, 'mani_admin')).GetAwaiter().GetResult()
    Check 'Admin page available' ($admin.StatusCode -eq 200) ([int]$admin.StatusCode)
    $root = $client.GetAsync($base).GetAwaiter().GetResult()
    Check 'Root redirect uses HTTPS' ([int]$root.StatusCode -in @(301,302,307,308) -and $root.Headers.Location.Scheme -eq 'https') $root.Headers.Location.AbsoluteUri
    [pscustomobject]@{checkedAt=[DateTime]::UtcNow.ToString('o'); origin=$base.AbsoluteUri; checks=$checks; authenticatedMcp='NOT TESTED: requires owner OAuth'; hostingReads='NOT TESTED by this anonymous probe'} | ConvertTo-Json -Depth 6
    if ($checks.result -contains 'FAIL') { exit 1 }
} finally { $client.Dispose(); $handler.Dispose() }
