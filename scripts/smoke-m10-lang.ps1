$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$base = 'http://127.0.0.1:1690'
$BE = "$base/api/backend"
$H = @{ Origin = 'http://127.0.0.1:1690' }
$pass = 0; $fail = 0
function Check($name, $cond) {
  if ($cond) { Write-Host "PASS: $name"; $script:pass++ }
  else { Write-Host "FAIL: $name"; $script:fail++ }
}
function Put-Json($uri, $obj, $sess) {
  $json = $obj | ConvertTo-Json -Compress -Depth 5
  return Invoke-RestMethod -Method Put -Uri $uri -ContentType 'application/json; charset=utf-8' -Headers $H -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -WebSession $sess
}

Write-Host '== M10.0 wait for backend health =='
$up = $false
for ($i = 0; $i -lt 20; $i++) {
  try { Invoke-RestMethod "$base/health" -TimeoutSec 3 | Out-Null; $up = $true; break } catch { Start-Sleep -Seconds 3 }
}
Check 'backend health up' $up

Write-Host '== M10.1 admin login =='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"admin","password":"admin-Startup-2026"}' -SessionVariable adminSess | Out-Null
Check 'admin logged in' ($null -ne $adminSess)

Write-Host '== M10.2 site-settings view carries defaultLanguage =='
$site = Invoke-RestMethod "$BE/enterprise/admin/site-settings" -WebSession $adminSess
Check 'defaultLanguage present (string)' ($site.data.defaultLanguage -is [string])
Check 'defaultLanguage in whitelist' (@('zh-CN','en','vi','ja','ar','fr','es','ru') -contains $site.data.defaultLanguage)

try {
  Write-Host '== M10.3 save defaultLanguage=fr then read back (admin + public) =='
  Put-Json "$BE/enterprise/admin/site-settings" @{ defaultLanguage = 'fr' } $adminSess | Out-Null
  $siteFr = Invoke-RestMethod "$BE/enterprise/admin/site-settings" -WebSession $adminSess
  Check 'admin view returns fr' ($siteFr.data.defaultLanguage -eq 'fr')
  $pub = Invoke-RestMethod "$base/api/site-config"
  Check 'public site-config exposes fr' ($pub.data.defaultLanguage -eq 'fr')

  Write-Host '== M10.4 switching to ar works (RTL language) =='
  Put-Json "$BE/enterprise/admin/site-settings" @{ defaultLanguage = 'ar' } $adminSess | Out-Null
  $siteAr = Invoke-RestMethod "$BE/enterprise/admin/site-settings" -WebSession $adminSess
  Check 'admin view returns ar' ($siteAr.data.defaultLanguage -eq 'ar')

  Write-Host '== M10.5 unsupported language rejected with 400 =='
  $rejected = $false
  try { Put-Json "$BE/enterprise/admin/site-settings" @{ defaultLanguage = 'de' } $adminSess | Out-Null } catch { $rejected = $true }
  Check 'de rejected' $rejected
  $siteAfter = Invoke-RestMethod "$BE/enterprise/admin/site-settings" -WebSession $adminSess
  Check 'value unchanged after rejected save' ($siteAfter.data.defaultLanguage -eq 'ar')

  Write-Host '== M10.6 partial save does not lose defaultLanguage =='
  Put-Json "$BE/enterprise/admin/site-settings" @{ siteDesc = 'm10 desc' } $adminSess | Out-Null
  $sitePartial = Invoke-RestMethod "$BE/enterprise/admin/site-settings" -WebSession $adminSess
  Check 'defaultLanguage survives partial save' ($sitePartial.data.defaultLanguage -eq 'ar')
}
finally {
  Write-Host '== M10.7 restore original defaultLanguage =='
  Put-Json "$BE/enterprise/admin/site-settings" @{ defaultLanguage = $site.data.defaultLanguage } $adminSess | Out-Null
}

Write-Host "== M10 DONE pass=$pass fail=$fail =="
if ($fail -gt 0) { exit 1 }
