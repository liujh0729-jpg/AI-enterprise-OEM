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
$rnd = Get-Random -Minimum 1000 -Maximum 999999
$code = "SMOKE-CODE-$rnd"
$user = "m8alice$rnd"
$fakeKey = 'sk-a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6'

Write-Host '== M8.1 admin login =='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"admin","password":"admin-Startup-2026"}' -SessionVariable adminSess | Out-Null
Check 'admin login ok' ($adminSess -ne $null)

$orig = Invoke-RestMethod "$BE/enterprise/admin/site-settings" -WebSession $adminSess
$origCode = $orig.data.aipddReferralCode
$origHidden = @($orig.data.businessMenuHidden)
$hiddenJson = ConvertTo-Json -InputObject @('/tax', '/legal') -Compress
try {
  Write-Host '== M8.2 admin saves AIPDD referral code + hides business menus =='
  $saved = Invoke-RestMethod -Method Put -Uri "$BE/enterprise/admin/site-settings" -ContentType 'application/json' -Headers $H -Body ('{"aipddReferralCode":"' + $code + '","businessMenuHidden":' + $hiddenJson + '}') -WebSession $adminSess
  Check 'site settings echoes referral code' ($saved.data.aipddReferralCode -eq $code)
  Check 'site settings echoes hidden menus' (($saved.data.businessMenuHidden -join ',') -eq '/tax,/legal')

  Write-Host '== M8.3 public site-config exposes referral code + menu visibility =='
  $pub = Invoke-RestMethod "$base/api/site-config"
  Check 'public site-config carries code' ($pub.data.aipddReferralCode -eq $code)
  Check 'public site-config carries hidden menus' (($pub.data.businessMenuHidden -join ',') -eq '/tax,/legal')

  Write-Host '== M8.4 user aipdd-key status: unbound + register guidance =='
  Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body ('{"mode":"USERNAME","username":"' + $user + '","password":"M8-Test-1234"}') | Out-Null
  Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $user + '","password":"M8-Test-1234"}') -SessionVariable UA | Out-Null
  $st = Invoke-RestMethod "$BE/enterprise/account/aipdd-key" -WebSession $UA
  Check 'status unbound' ($st.data.bound -eq $false)
  Check 'registerUrl is www.aipdd.work' ($st.data.registerUrl -eq 'https://www.aipdd.work')
  Check 'status carries referral code' ($st.data.referralCode -eq $code)

  Write-Host '== M8.5 bind keeps guidance + masked only =='
  $bound = Invoke-RestMethod -Method Put -Uri "$BE/enterprise/account/aipdd-key" -ContentType 'application/json' -Headers $H -Body ('{"key":"' + $fakeKey + '"}') -WebSession $UA
  Check 'bound=true' ($bound.data.bound -eq $true)
  Check 'masked starts with sk-' ($bound.data.masked -like 'sk-*')
  Check 'plain key never returned' (($bound.data | ConvertTo-Json -Depth 6) -notmatch $fakeKey)
  Check 'referral code still present when bound' ($bound.data.referralCode -eq $code)

  Write-Host '== M8.6 unbind then guidance still visible =='
  Invoke-RestMethod -Method Delete -Uri "$BE/enterprise/account/aipdd-key" -Headers $H -WebSession $UA | Out-Null
  $st2 = Invoke-RestMethod "$BE/enterprise/account/aipdd-key" -WebSession $UA
  Check 'unbound again' ($st2.data.bound -eq $false)
  Check 'code kept after unbind' ($st2.data.referralCode -eq $code)
}
finally {
  Write-Host '== M8.7 restore original settings (always) =='
  try {
    $origHiddenJson = ConvertTo-Json -InputObject $origHidden -Compress
    Invoke-RestMethod -Method Put -Uri "$BE/enterprise/admin/site-settings" -ContentType 'application/json' -Headers $H -Body ('{"aipddReferralCode":"' + $origCode + '","businessMenuHidden":' + $origHiddenJson + '}') -WebSession $adminSess | Out-Null
    $restored = Invoke-RestMethod "$BE/enterprise/admin/site-settings" -WebSession $adminSess
    Check 'original code restored' ($restored.data.aipddReferralCode -eq $origCode)
    Check 'hidden menus restored' (($restored.data.businessMenuHidden -join ',') -eq ($origHidden -join ','))
  } catch {
    Write-Host "WARN: restore referral code failed: $($_.Exception.Message)"
    $script:fail++
  }
}

Write-Host "== M8 DONE pass=$pass fail=$fail =="
if ($fail -gt 0) { exit 1 }
