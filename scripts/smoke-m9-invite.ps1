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
$rnd = Get-Random -Minimum 1000 -Maximum 999999
$userA = "m9alice$rnd"
$userB = "m9bob$rnd"
$userC = "m9eve$rnd"
$pw = 'M9-Test-1234'

Write-Host '== M9.0 wait for backend health =='
$up = $false
for ($i = 0; $i -lt 20; $i++) {
  try { Invoke-RestMethod "$base/health" -TimeoutSec 3 | Out-Null; $up = $true; break } catch { Start-Sleep -Seconds 3 }
}
Check 'backend health up' $up

Write-Host '== M9.1 register A without invite code, then get own code =='
Post-Json "$base/api/auth/local/register" @{ mode = 'USERNAME'; username = $userA; password = $pw } $null | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $userA + '","password":"' + $pw + '"}') -SessionVariable sessA | Out-Null
$invA = Invoke-RestMethod "$BE/enterprise/account/invite" -WebSession $sessA
Check 'A invite code generated (6-8 chars, no confusing glyphs)' ($invA.data.inviteCode -match '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,8}$')
Check 'A has no inviter' ($null -eq $invA.data.invitedBy)

Write-Host '== M9.2 register B with A code: relation recorded both ways =='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body ('{"mode":"USERNAME","username":"' + $userB + '","password":"' + $pw + '","inviteCode":"' + $invA.data.inviteCode + '"}') | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $userB + '","password":"' + $pw + '"}') -SessionVariable sessB | Out-Null
$invB = Invoke-RestMethod "$BE/enterprise/account/invite" -WebSession $sessB
Check 'B invitedBy is A' ($invB.data.invitedBy.username -eq $userA)
$invA2 = Invoke-RestMethod "$BE/enterprise/account/invite" -WebSession $sessA
Check 'A invitedCount >= 1' ($invA2.data.invitedCount -ge 1)
Check 'B own code also generated' ($invB.data.inviteCode -match '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,8}$')

Write-Host '== M9.3 lowercase code accepted (case insensitive) =='
$lower = $invA.data.inviteCode.ToLower()
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body ('{"mode":"USERNAME","username":"' + $userC + '","password":"' + $pw + '","inviteCode":"' + $lower + '"}') | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $userC + '","password":"' + $pw + '"}') -SessionVariable sessC | Out-Null
$invC = Invoke-RestMethod "$BE/enterprise/account/invite" -WebSession $sessC
Check 'C invitedBy is A via lowercase code' ($invC.data.invitedBy.username -eq $userA)

Write-Host '== M9.4 bogus invite code rejected with 400 =='
$rejected = $false
try {
  Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body ('{"mode":"USERNAME","username":"m9ghost' + $rnd + '","password":"' + $pw + '","inviteCode":"ZZZZ99"}') | Out-Null
} catch {
  $rejected = $true
}
Check 'invalid code rejected' $rejected

Write-Host '== M9.5 admin users list carries invite columns =='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"admin","password":"admin-Startup-2026"}' -SessionVariable adminSess | Out-Null
$users = Invoke-RestMethod "$BE/enterprise/admin/users" -WebSession $adminSess
$rowB = @($users.data | Where-Object { $_.username -eq $userB })
Check 'admin sees B row' ($rowB.Count -eq 1)
Check 'B row has inviter username A' ($rowB[0].invitedByUsername -eq $userA)
Check 'B row has own invite code' ($rowB[0].inviteCode -match '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,8}$')

Write-Host "== M9 DONE pass=$pass fail=$fail =="
if ($fail -gt 0) { exit 1 }
