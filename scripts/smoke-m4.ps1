$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$base = 'http://127.0.0.1:1690'
$B = "$base/api/backend"
function J($o) { $o | ConvertTo-Json -Compress -Depth 8 }
$H = @{ Origin = 'http://127.0.0.1:1690' }

Write-Host '== M4.1 public GET /api/site-config =='
J (Invoke-RestMethod "$base/api/site-config")

Write-Host '== M4.2 admin login =='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"admin","password":"admin-Startup-2026"}' -SessionVariable admin | Out-Null

Write-Host '== M4.3 PUT admin/site-settings (name/logo/icp) =='
$site = '{"siteName":"OEM Workbench","siteLogo":"/logo.png","siteDesc":"open source enterprise","icpRecord":"ICP-00000001","footerLinks":[{"label":"about","url":"/about"}]}'
J (Invoke-RestMethod -Method Put -Uri "$B/enterprise/admin/site-settings" -ContentType 'application/json' -Headers $H -Body $site -WebSession $admin)

Write-Host '== M4.4 public reflects saved site config =='
$pub = Invoke-RestMethod "$base/api/site-config"
if ($pub.data.siteName -eq 'OEM Workbench' -and $pub.data.icpRecord -eq 'ICP-00000001') {
  Write-Host 'PASS: site rename/logo/ICP took effect immediately'
} else { Write-Host 'FAIL: site config not reflected'; J $pub }

Write-Host '== M4.5 non-admin blocked (403) =='
try {
  Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body '{"mode":"USERNAME","username":"m4user","password":"M4-Test-1234"}' | Out-Null
} catch {}
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"m4user","password":"M4-Test-1234"}' -SessionVariable normal | Out-Null
try {
  Invoke-RestMethod "$B/enterprise/admin/site-settings" -WebSession $normal | Out-Null
  Write-Host 'FAIL: non-admin reached admin endpoint'
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 403) { Write-Host 'PASS: non-admin blocked with 403' } else { Write-Host ("FAIL: expected 403 got " + $code) }
}
Write-Host '== M4 DONE =='
