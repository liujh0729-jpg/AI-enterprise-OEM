$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$base = 'http://127.0.0.1:1690'
$B = "$base/api/backend"
function J($o) { $o | ConvertTo-Json -Compress -Depth 6 }
# 浏览器同源请求必带 Origin；后端 CSRF 白名单在开发态放行 loopback
$H = @{ Origin = 'http://127.0.0.1:1690' }

Write-Host '== 1. account-config =='
J (Invoke-RestMethod "$base/api/auth/account-config")

Write-Host '== 2. register alice =='
try {
  $reg = Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body '{"mode":"USERNAME","username":"alice","password":"Alice-Test-123"}'
  J $reg
} catch { J ($_.ErrorDetails.Message | ConvertFrom-Json) }

Write-Host '== 3. login alice =='
$login = Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"alice","password":"Alice-Test-123"}' -SessionVariable alice
J $login

Write-Host '== 4. profile + me =='
J (Invoke-RestMethod "$B/enterprise/account/profile" -WebSession $alice)
J (Invoke-RestMethod "$B/enterprise/me" -WebSession $alice)

Write-Host '== 5. bind aipdd key (verify off, N:1) =='
$keyBody = '{"key":"sk-' + ('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718'.ToLower()) + '"}'
J (Invoke-RestMethod -Method Put -Uri "$B/enterprise/account/aipdd-key" -ContentType 'application/json' -Headers $H -Body $keyBody -WebSession $alice)

Write-Host '== 6. register bob + bind SAME key -> sharedWith=2 =='
try { Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body '{"mode":"USERNAME","username":"bob","password":"Bob-Test-1234"}' | Out-Null } catch {}
$loginB = Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"bob","password":"Bob-Test-1234"}' -SessionVariable bob
J (Invoke-RestMethod -Method Put -Uri "$B/enterprise/account/aipdd-key" -ContentType 'application/json' -Headers $H -Body $keyBody -WebSession $bob)
J (Invoke-RestMethod "$B/enterprise/account/aipdd-key" -WebSession $bob)

Write-Host '== 7. unbound user carol resolve -> should still work local, aipdd status unbound =='
try { Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body '{"mode":"USERNAME","username":"carol","password":"Carol-Test-123"}' | Out-Null } catch {}
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"carol","password":"Carol-Test-123"}' -SessionVariable carol | Out-Null
J (Invoke-RestMethod "$B/enterprise/account/aipdd-key" -WebSession $carol)

Write-Host '== 8. admin login + settings + ban alice =='
$admin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"admin","password":"admin-Startup-2026"}' -SessionVariable adminSess
J $admin
J (Invoke-RestMethod "$B/enterprise/admin/account/settings" -WebSession $adminSess)
J (Invoke-RestMethod -Method Post -Uri "$B/enterprise/admin/account/users/2/ban" -ContentType 'application/json' -Headers $H -Body '{"reason":"smoke test ban"}' -WebSession $adminSess)
Write-Host '-- alice request after ban (expect 403) --'
try {
  Invoke-RestMethod "$B/enterprise/account/profile" -WebSession $alice | Out-Null
  Write-Host 'ERROR: ban not enforced!'
} catch { Write-Host ("blocked: " + $_.Exception.Response.StatusCode.value__) }

Write-Host '== 9. unban + alice re-login + change password invalidates old session =='
J (Invoke-RestMethod -Method Post -Uri "$B/enterprise/admin/account/users/2/unban" -Headers $H -WebSession $adminSess)
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"alice","password":"Alice-Test-123"}' -SessionVariable alice2 | Out-Null
J (Invoke-RestMethod -Method Post -Uri "$B/enterprise/account/password" -ContentType 'application/json' -Headers $H -Body '{"oldPassword":"Alice-Test-123","newPassword":"Alice-Test-456"}' -WebSession $alice2)
Write-Host '-- old session after password change (expect 401) --'
try {
  Invoke-RestMethod "$B/enterprise/account/profile" -WebSession $alice | Out-Null
  Write-Host 'ERROR: old session still valid!'
} catch { Write-Host ("blocked: " + $_.Exception.Response.StatusCode.value__) }
Write-Host '-- new session works --'
J (Invoke-RestMethod "$B/enterprise/account/profile" -WebSession $alice2)

Write-Host '== 10. forgot password without SMTP configured (expect graceful error) =='
try {
  Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/forgot" -ContentType 'application/json' -Headers $H -Body '{"channel":"EMAIL","target":"nobody@example.com"}' | Out-Null
  Write-Host 'sent (account not found path stays silent)'
} catch { J ($_.ErrorDetails.Message | ConvertFrom-Json) }

Write-Host '== 11. login logs =='
J (Invoke-RestMethod "$B/enterprise/account/login-logs" -WebSession $alice2)

Write-Host '== 12. admin reset bob password (fallback path) =='
$reset = Invoke-RestMethod -Method Post -Uri "$B/enterprise/admin/account/users/3/reset-password" -Headers $H -WebSession $adminSess
J $reset
$newPw = $reset.data.newPassword
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"bob","password":"' + $newPw + '"}') -SessionVariable bob2 | Out-Null
J (Invoke-RestMethod -Method Post -Uri "$B/enterprise/account/password" -ContentType 'application/json' -Headers $H -Body ('{"oldPassword":"' + $newPw + '","newPassword":"Bob-Test-9999"}') -WebSession $bob2)

Write-Host '== 13. local ek_ apikey via identity + machine channel call =='
$keys = Invoke-RestMethod -Method Post -Uri "$B/enterprise/api-keys" -Headers $H -WebSession $alice2
J $keys
$plain = $keys.data.plainKey
if ($plain) {
  $ping = Invoke-RestMethod -Uri "$B/api/v1/data-tables" -Headers @{ 'x-api-key' = $plain } -Method Get
  Write-Host ('machine channel ok, code=' + $ping.code)
} else { Write-Host 'key plain not in response, skip machine call' }
Write-Host '== ALL DONE =='
