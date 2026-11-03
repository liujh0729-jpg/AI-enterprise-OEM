# Points + OSS smoke: public config -> register bonus -> admin settings/pricing/adjust -> gift transfer -> recharge guard -> admin lists -> OSS migration status -> digital assets list.
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
function Post-Json($uri, $obj, $sess) {
  $json = $obj | ConvertTo-Json -Compress
  if ($sess) { return Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Headers $H -Body $json -WebSession $sess }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Headers $H -Body $json
}
function Put-Json($uri, $obj, $sess) {
  $json = $obj | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Put -Uri $uri -ContentType 'application/json' -Headers $H -Body $json -WebSession $sess
}
function Near($a, $b) { return ([math]::Abs([double]$a - [double]$b) -lt 0.0001) }

Write-Host '== P9.0 backend health =='
$up = $false
for ($i = 0; $i -lt 20; $i++) {
  try { Invoke-RestMethod "$base/health" -TimeoutSec 3 | Out-Null; $up = $true; break } catch { Start-Sleep -Seconds 2 }
}
Check 'backend health up' $up
if (-not $up) { Write-Host "== P9 DONE pass=$pass fail=$fail =="; exit 1 }

Write-Host '== P9.1 public points-config =='
$cfg = Invoke-RestMethod "$base/api/points-config"
Check 'public config code=0' ($cfg.code -eq 0)
Check 'rate positive' ([double]$cfg.data.rate -gt 0)
Check 'recharge tiers present' (@($cfg.data.rechargeTiers).Count -ge 1)
Check 'transferMin returned' ($null -ne $cfg.data.transferMin)
Check 'wechatConfigured boolean' ($cfg.data.wechatConfigured -is [bool])

Write-Host '== P9.2 admin login + points settings =='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"admin","password":"admin-Startup-2026"}' -SessionVariable adminSess | Out-Null
$aset = Invoke-RestMethod "$BE/enterprise/admin/points/settings" -WebSession $adminSess
Check 'admin settings readable' ($aset.code -eq 0 -and $null -ne $aset.data.rate)
Check 'admin sees wechatConfigured flag' ($aset.data.wechatConfigured -is [bool])
$signupBonus = [double]$aset.data.signupBonus

Write-Host '== P9.3 register two fresh users, signup bonus visible =='
$rnd = Get-Random -Minimum 100000 -Maximum 999999
$u1 = "p9a$rnd"; $u2 = "p9b$rnd"; $pw = 'P9-Smoke-1234'
Post-Json "$base/api/auth/local/register" @{ mode = 'USERNAME'; username = $u1; password = $pw } $null | Out-Null
Post-Json "$base/api/auth/local/register" @{ mode = 'USERNAME'; username = $u2; password = $pw } $null | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $u1 + '","password":"' + $pw + '"}') -SessionVariable sessU1 | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $u2 + '","password":"' + $pw + '"}') -SessionVariable sessU2 | Out-Null
$sum1 = Invoke-RestMethod "$BE/enterprise/points/summary" -WebSession $sessU1
Check 'summary points balance numeric' ($null -ne $sum1.data.points.balance)
Check 'summary account status set' (-not [string]::IsNullOrEmpty($sum1.data.points.status))
Check "signup bonus >= $signupBonus" ([double]$sum1.data.points.balance -ge $signupBonus)
Check 'awcoin wrapper present (null when unbound)' ($null -ne $sum1.data.awcoin)
$uset = Invoke-RestMethod "$BE/enterprise/points/settings" -WebSession $sessU1
Check 'user settings has rate/transfer keys' ($null -ne $uset.data.rate -and $null -ne $uset.data.transferEnabled)

Write-Host '== P9.4 pricing list + bi price roundtrip =='
$pricing = Invoke-RestMethod "$BE/enterprise/admin/points/pricing" -WebSession $adminSess
$codes = @($pricing.data | ForEach-Object { $_.code })
foreach ($code in @('asset_storage', 'bi', 'crm', 'oa', 'ai_customer')) {
  Check "pricing has $code" ($codes -contains $code)
}
$biRow = @($pricing.data | Where-Object { $_.code -eq 'bi' })[0]
$origBi = [double]$biRow.unitPriceAmount
$newBi = if ($origBi -ne 0.6) { 0.6 } else { 0.7 }
$upd = Put-Json "$BE/enterprise/admin/points/pricing/bi" @{ unitPriceAmount = $newBi } $adminSess
Check 'bi price updated' (Near $upd.data.unitPriceAmount $newBi)
$revert = Put-Json "$BE/enterprise/admin/points/pricing/bi" @{ unitPriceAmount = $origBi } $adminSess
Check 'bi price restored' (Near $revert.data.unitPriceAmount $origBi)

Write-Host '== P9.5 admin adjust + admin transactions =='
$acc = Invoke-RestMethod "$BE/enterprise/admin/points/accounts?keyword=$u1" -WebSession $adminSess
Check 'admin accounts find U1' (@($acc.data.list).Count -ge 1)
$uid1 = @($acc.data.list)[0].userId
$balBefore = [double]$sum1.data.points.balance
Post-Json "$BE/enterprise/admin/points/adjust" @{ userId = $uid1; delta = 7.5; remark = 'p9 smoke adjust' } $adminSess | Out-Null
$sum1Adj = Invoke-RestMethod "$BE/enterprise/points/summary" -WebSession $sessU1
Check 'adjust +7.5 reflected' (Near $sum1Adj.data.points.balance ($balBefore + 7.5))
Post-Json "$BE/enterprise/admin/points/adjust" @{ userId = $uid1; delta = -7.5; remark = 'p9 smoke revert' } $adminSess | Out-Null
$sum1Rev = Invoke-RestMethod "$BE/enterprise/points/summary" -WebSession $sessU1
Check 'adjust -7.5 reverted' (Near $sum1Rev.data.points.balance $balBefore)
$txAdmin = Invoke-RestMethod "$BE/enterprise/admin/points/transactions/$uid1" -WebSession $adminSess
$types = @($txAdmin.data.list | ForEach-Object { $_.type })
Check 'admin transaction log has ADMIN_ADJUST' ($types -contains 'ADMIN_ADJUST')

Write-Host '== P9.6 gift transfer U1 -> U2 =='
if ([double]$sum1Rev.data.points.balance -lt 5) {
  Post-Json "$BE/enterprise/admin/points/adjust" @{ userId = $uid1; delta = 100; remark = 'p9 smoke float' } $adminSess | Out-Null
}
$preview = Post-Json "$BE/enterprise/points/transfer/preview" @{ to = $u2 } $sessU1
Check 'transfer preview resolves U2' ($preview.data.exists -eq $true)
$sum1T = Invoke-RestMethod "$BE/enterprise/points/summary" -WebSession $sessU1
$sum2T = Invoke-RestMethod "$BE/enterprise/points/summary" -WebSession $sessU2
$b1 = [double]$sum1T.data.points.balance
$b2 = [double]$sum2T.data.points.balance
$t = Post-Json "$BE/enterprise/points/transfer" @{ to = $u2; amount = 5 } $sessU1
Check 'transfer sent 5' (Near $t.data.sent 5)
Check 'transfer received = sent - fee' (Near $t.data.received (5 - [double]$t.data.fee))
$sum1A = Invoke-RestMethod "$BE/enterprise/points/summary" -WebSession $sessU1
$sum2A = Invoke-RestMethod "$BE/enterprise/points/summary" -WebSession $sessU2
Check 'sender balance -5' (Near $sum1A.data.points.balance ($b1 - 5))
Check 'receiver balance +received' (Near $sum2A.data.points.balance ($b2 + [double]$t.data.received))
$tx2 = Invoke-RestMethod "$BE/enterprise/points/transactions" -WebSession $sessU2
$types2 = @($tx2.data.list | ForEach-Object { $_.type })
Check 'receiver transaction log has TRANSFER_IN' ($types2 -contains 'TRANSFER_IN')

Write-Host '== P9.7 recharge create guarded by wechat config =='
$rejected = $false; $status = 0
try { Post-Json "$BE/enterprise/points/recharge/create" @{ amountCents = 1000; channel = 'NATIVE' } $sessU1 | Out-Null }
catch { $rejected = $true; $status = [int]$_.Exception.Response.StatusCode }
if ($cfg.data.wechatConfigured) {
  Check 'recharge create accepted when wechat configured' (-not $rejected)
} else {
  Check "recharge rejected while wechat unconfigured (got $status)" ($rejected -and $status -ge 400)
}

Write-Host '== P9.8 admin lists: orders / usage =='
$orders = Invoke-RestMethod "$BE/enterprise/admin/points/orders" -WebSession $adminSess
Check 'admin orders list ok' ($orders.code -eq 0)
$usage = Invoke-RestMethod "$BE/enterprise/admin/points/usage" -WebSession $adminSess
Check 'admin usage list ok' ($usage.code -eq 0)

Write-Host '== P9.9 digital assets list (marketing outputs sink) =='
$assetsOk = $false
$assetsStatus = 200
try {
  $assets = Invoke-RestMethod "$BE/enterprise/content/digital-assets?page=1&size=5" -WebSession $sessU1
  $assetsOk = ($assets.code -eq 0)
} catch {
  # 未绑定 AIPDD Key 的账号访问上游同步功能返回 403：既有业务门禁，冒烟视为通过
  $assetsStatus = [int]$_.Exception.Response.StatusCode
  $assetsOk = ($assetsStatus -eq 403)
  Write-Host "  (digital assets gated: HTTP $assetsStatus - bind AIPDD key to list upstream assets)"
}
Check 'digital assets endpoint responds (ok or gated 403)' $assetsOk

Write-Host "== P9 points smoke DONE pass=$pass fail=$fail =="
if ($fail -gt 0) { exit 1 }