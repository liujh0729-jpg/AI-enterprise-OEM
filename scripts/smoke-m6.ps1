$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$base = 'http://127.0.0.1:1690'
$BE = "$base/api/backend"
$S = "$BE/enterprise/social"
$L = "$S/listings"
$H = @{ Origin = 'http://127.0.0.1:1690' }
$pass = 0; $fail = 0
function Check($name, $cond) {
  if ($cond) { Write-Host "PASS: $name"; $script:pass++ }
  else { Write-Host "FAIL: $name"; $script:fail++ }
}
$rnd = Get-Random -Minimum 1000 -Maximum 999999
$userA = "m6alice$rnd"
$userB = "m6bob$rnd"

Write-Host '== M6.1 register + login two users =='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body ('{"mode":"USERNAME","username":"' + $userA + '","password":"M6-Test-1234"}') | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body ('{"mode":"USERNAME","username":"' + $userB + '","password":"M6-Test-1234"}') | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $userA + '","password":"M6-Test-1234"}') -SessionVariable SA | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $userB + '","password":"M6-Test-1234"}') -SessionVariable SB | Out-Null
$pa = Invoke-RestMethod -Method Put -Uri "$S/profile" -ContentType 'application/json' -Headers $H -Body '{"title":"CTO"}' -WebSession $SA
$Aid = $pa.data.person.userId
Check 'A userId resolved' ($Aid -gt 0)

Write-Host '== M6.2 category dictionary exposed =='
$cats = Invoke-RestMethod "$L/categories" -WebSession $SA
$sub = $cats.data[0].options[0].id
Check 'listing categories available' (@($cats.data).Count -ge 1 -and $sub.Length -gt 0)

Write-Host '== M6.3 A local-publish DEMAND (no key) =='
$dm = Invoke-RestMethod -Method Post -Uri "$L" -ContentType 'application/json' -Headers $H -Body ('{"type":"DEMAND","title":"need-bookkeeping-' + $rnd + '","description":"monthly books for small shop","tags":["tax","monthly"],"province":"Shanghai","city":"Shanghai","subcategoryId":"' + $sub + '"}') -WebSession $SA
Check 'demand created LOCAL_PUBLISHED without key' ($dm.data.id -gt 0 -and $dm.data.status -eq 'LOCAL_PUBLISHED')

Write-Host '== M6.4 A local-publish SERVICE (no key) =='
$sv = Invoke-RestMethod -Method Post -Uri "$L" -ContentType 'application/json' -Headers $H -Body ('{"type":"SERVICE","title":"logo-design-' + $rnd + '","description":"brand logo and vi","moneyMode":"FIXED","amountMin":800}') -WebSession $SA
Check 'service created without key' ($sv.data.id -gt 0 -and $sv.data.type -eq 'SERVICE')

Write-Host '== M6.5 B sees both posts in feed (public info flow) =='
$feed = Invoke-RestMethod "$L" -WebSession $SB
Check 'B feed lists A demand + service' (@($feed.data | Where-Object { $_.id -eq $dm.data.id }).Count -eq 1 -and @($feed.data | Where-Object { $_.id -eq $sv.data.id }).Count -eq 1)

Write-Host '== M6.6 demand category labels hydrated from subcategoryId =='
Check 'demand carries category1 + category2' ($dm.data.category1.Length -gt 0 -and $dm.data.category2.Length -gt 0)

Write-Host '== M6.7 unbound A cannot sync upstream (403) =='
try {
  Invoke-RestMethod -Method Post -Uri "$L/$($dm.data.id)/publish-upstream" -ContentType 'application/json' -Headers $H -Body '{"deadline":"2030-01-01T00:00:00.000Z","contactPhone":"13800000000"}' -WebSession $SA | Out-Null
  Check 'unbound publish-upstream rejected' $false
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  Check 'unbound publish-upstream gives 403' ($code -eq 403)
}

Write-Host '== M6.8 local post stays LOCAL_PUBLISHED after failed sync =='
$st = Invoke-RestMethod "$L/$($dm.data.id)" -WebSession $SA
Check 'demand still LOCAL_PUBLISHED, not upstream' ($st.data.status -eq 'LOCAL_PUBLISHED' -and $st.data.publishedUpstream -eq $false)

Write-Host '== M6.9 mine lists A own posts only =='
$mine = Invoke-RestMethod "$L/mine" -WebSession $SA
Check 'A owns 2 listings in mine' (@($mine.data).Count -eq 2 -and @($mine.data | Where-Object { $_.author.userId -ne $Aid }).Count -eq 0)

Write-Host '== M6.10 B cannot delete A post; A can =='
try {
  Invoke-RestMethod -Method Delete -Uri "$L/$($sv.data.id)" -Headers $H -WebSession $SB | Out-Null
  Check 'non-owner delete blocked' $false
} catch {
  Check 'non-owner delete gives error' $true
}
$del = Invoke-RestMethod -Method Delete -Uri "$L/$($sv.data.id)" -Headers $H -WebSession $SA
Check 'owner deletes own service' ($del.data.deleted -eq $true)

Write-Host ("== M6 DONE pass=" + $pass + " fail=" + $fail + " ==")
if ($fail -gt 0) { exit 1 }
