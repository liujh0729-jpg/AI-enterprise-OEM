$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$base = 'http://127.0.0.1:1690'
$B = "$base/api/backend"
function J($o) { $o | ConvertTo-Json -Compress -Depth 8 }
function Put($body, $session) {
  Invoke-RestMethod -Method Put -Uri "$B/enterprise/admin/site-settings" -ContentType 'application/json' -Headers $H -Body $body -WebSession $session
}
$H = @{ Origin = 'http://127.0.0.1:1690' }
$pass = 0; $fail = 0
function Check($name, $cond, $extra) {
  if ($cond) { $script:pass++; Write-Host ("PASS: " + $name) }
  else { $script:fail++; Write-Host ("FAIL: " + $name + " " + $extra) }
}

Write-Host '== S1 public site-config exposes siteUrl field =='
$pub0 = Invoke-RestMethod "$base/api/site-config"
Check 'site-config carries siteUrl' ($null -ne $pub0.data.PSObject.Properties['siteUrl']) (J $pub0.data)
$origin = [string]$pub0.data.siteUrl

Write-Host '== S2 admin login =='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"admin","password":"admin-Startup-2026"}' -SessionVariable admin | Out-Null

Write-Host '== S3 scheme omitted -> normalized to https origin =='
$r = Put '{"siteUrl":"oa.example.com"}' $admin
Check 'bare host becomes https origin' ($r.data.siteUrl -eq 'https://oa.example.com') (J $r.data)

Write-Host '== S4 trailing path and port -> origin only =='
$r = Put '{"siteUrl":"http://oa.example.com:8443/portal/"}' $admin
Check 'port kept, subpath dropped' ($r.data.siteUrl -eq 'http://oa.example.com:8443') (J $r.data)

Write-Host '== S5 public config reflects configured domain =='
$pub1 = Invoke-RestMethod "$base/api/site-config"
Check 'public echoes https-less origin' ($pub1.data.siteUrl -eq 'http://oa.example.com:8443') (J $pub1.data)

Write-Host '== S6 invalid values normalize to empty =='
foreach ($bad in @('ftp://oa.example.com', 'https://user@evil.example', 'http://a b', '  ')) {
  $r = Put (J @{ siteUrl = $bad }) $admin
  Check ("reject [" + $bad + "]") ($r.data.siteUrl -eq '') (J $r.data)
}

Write-Host '== S7 empty value clears -> frontend falls back to visitor origin =='
$r = Put '{"siteUrl":""}' $admin
Check 'clear keeps field empty' ($r.data.siteUrl -eq '') (J $r.data)

Write-Host '== S8 omitted field keeps stored value (partial save) =='
Put '{"siteUrl":"https://keep.example"}' $admin | Out-Null
$r = Put '{"siteDesc":"smoke-site-url"}' $admin
Check 'omitted siteUrl keeps stored value' ($r.data.siteUrl -eq 'https://keep.example') (J $r.data)

Write-Host '== S9 restore original value =='
Put (J @{ siteUrl = $origin; siteDesc = '' }) $admin | Out-Null
$pub2 = Invoke-RestMethod "$base/api/site-config"
Check 'restored to original siteUrl' ($pub2.data.siteUrl -eq $origin) (J $pub2.data)

Write-Host '== S10 frontend pages using site base render 200 =='
foreach ($path in @('/developer/mcp', '/developer/docs', '/admin/site', '/marketing-tools', '/service-desk', '/data-table', '/agent', '/staff', '/invite')) {
  try {
    $resp = Invoke-WebRequest -Uri ("http://127.0.0.1:15890" + $path) -UseBasicParsing -TimeoutSec 40
    Check ("page " + $path) ($resp.StatusCode -eq 200) $resp.StatusCode
  } catch {
    Check ("page " + $path) $false $_.Exception.Message
  }
}

Write-Host ('== SITE-URL DONE pass=' + $pass + ' fail=' + $fail + ' ==')
if ($fail -gt 0) { exit 1 }
