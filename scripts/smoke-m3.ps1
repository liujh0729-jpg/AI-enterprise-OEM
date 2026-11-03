$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$base = 'http://127.0.0.1:1690'
$B = "$base/api/backend"
function J($o) { $o | ConvertTo-Json -Compress -Depth 8 }
$H = @{ Origin = 'http://127.0.0.1:1690' }
$BOUND_KEY = 'sk-a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718'

Write-Host '== M3.1 register + login dave, bind key =='
try { Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body '{"mode":"USERNAME","username":"dave","password":"Dave-Test-1234"}' | Out-Null } catch {}
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"dave","password":"Dave-Test-1234"}' -SessionVariable dave | Out-Null
$keyBody = '{"key":"' + $BOUND_KEY + '"}'
J (Invoke-RestMethod -Method Put -Uri "$B/enterprise/account/aipdd-key" -ContentType 'application/json' -Headers $H -Body $keyBody -WebSession $dave)

Write-Host '== M3.2 dave GET demands -> mock upstream must receive Bearer <bound key> =='
$res = Invoke-RestMethod "$B/enterprise/aiworkin/demands" -WebSession $dave
J $res
$echo = ($res.data.list | Select-Object -First 1).title
if ($echo -eq ('auth:Bearer ' + $BOUND_KEY)) {
  Write-Host 'PASS: resolver injected bound key into upstream Authorization'
} else {
  Write-Host ("FAIL: upstream saw [" + $echo + "]")
}

Write-Host '== M3.3 dave POST publishDemand -> upstream receives bound key =='
$body = '{"title":"M3 smoke demand","description":"verify key injection","subcategoryId":"sub-1","moneyMode":"FIXED","amountMin":100,"amountMax":100,"deadline":"2027-01-01T00:00:00Z"}'
$pub = Invoke-RestMethod -Method Post -Uri "$B/enterprise/aiworkin/demands" -ContentType 'application/json' -Headers $H -Body $body -WebSession $dave
J $pub
if ($pub.data.listing.id) { Write-Host 'PASS: publish returned listing id' } else { Write-Host 'FAIL: publish no id' }

Write-Host '== M3.4 unbound user erin GET demands -> expect 403 =='
try { Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body '{"mode":"USERNAME","username":"erin","password":"Erin-Test-1234"}' | Out-Null } catch {}
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"erin","password":"Erin-Test-1234"}' -SessionVariable erin | Out-Null
try {
  Invoke-RestMethod "$B/enterprise/aiworkin/demands" -WebSession $erin | Out-Null
  Write-Host 'FAIL: unbound user was allowed upstream!'
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  Write-Host ("got HTTP " + $code)
  $msg = $_.ErrorDetails.Message
  if ($code -eq 403) { Write-Host 'PASS: unbound blocked with 403' } else { Write-Host ('FAIL: expected 403, got ' + $code) }
  Write-Host $msg
}

Write-Host '== M3.5 compat endpoint POST /api/auth/login works =='
$compat = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType 'application/json' -Headers $H -Body '{"username":"dave","password":"Dave-Test-1234"}' -SessionVariable compatSess
J $compat
Write-Host '== M3 DONE =='
