$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$base = 'http://127.0.0.1:1690'
$BE = "$base/api/backend"
$S = "$BE/enterprise/social"
function J($o) { $o | ConvertTo-Json -Compress -Depth 8 }
$H = @{ Origin = 'http://127.0.0.1:1690' }
$pass = 0; $fail = 0
function Check($name, $cond) {
  if ($cond) { Write-Host "PASS: $name"; $script:pass++ }
  else { Write-Host "FAIL: $name"; $script:fail++ }
}
$rnd = Get-Random -Minimum 1000 -Maximum 999999
$userA = "m5alice$rnd"
$userB = "m5bob$rnd"
$groupName = "m5group$rnd"

Write-Host '== M5.1 register + login two users =='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body ('{"mode":"USERNAME","username":"' + $userA + '","password":"M5-Test-1234"}') | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body ('{"mode":"USERNAME","username":"' + $userB + '","password":"M5-Test-1234"}') | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $userA + '","password":"M5-Test-1234"}') -SessionVariable SA | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $userB + '","password":"M5-Test-1234"}') -SessionVariable SB | Out-Null

Write-Host '== M5.2 save profile (resolve own userId) =='
$pa = Invoke-RestMethod -Method Put -Uri "$S/profile" -ContentType 'application/json' -Headers $H -Body '{"title":"CTO","city":"Shanghai","gender":"MALE","bio":"founder"}' -WebSession $SA
$pb = Invoke-RestMethod -Method Put -Uri "$S/profile" -ContentType 'application/json' -Headers $H -Body '{"title":"PM","city":"Beijing"}' -WebSession $SB
$Aid = $pa.data.person.userId
$Bid = $pb.data.person.userId
Check 'profile saved and userId resolved' ($Aid -and $Bid -and $pa.data.profile.title -eq 'CTO')

Write-Host '== M5.3 read other profile =='
$peer = Invoke-RestMethod "$S/profile/$Bid" -WebSession $SA
Check 'read peer profile by userId' ($peer.data.person.userId -eq $Bid)

Write-Host '== M5.4 friend request A -> B =='
$req = Invoke-RestMethod -Method Post -Uri "$S/friends/requests" -ContentType 'application/json' -Headers $H -Body ('{"toUserId":"' + $Bid + '","message":"hi"}') -WebSession $SA
Check 'friend request created (pending)' ($req.data.accepted -eq $false -and $req.data.requestId -gt 0)

Write-Host '== M5.5 B sees incoming request and accepts =='
$inbox = Invoke-RestMethod "$S/friends/requests" -WebSession $SB
$rid = @($inbox.data)[0].id
Check 'B has 1 pending request from A' ($rid -gt 0 -and @($inbox.data)[0].from.userId -eq $Aid)
Invoke-RestMethod -Method Post -Uri "$S/friends/requests/$rid/accept" -Headers $H -WebSession $SB | Out-Null
$friends = Invoke-RestMethod "$S/friends" -WebSession $SA
Check 'A friend list contains B after accept' (@($friends.data | Where-Object { $_.userId -eq $Bid }).Count -ge 1)

Write-Host '== M5.6 posts + feed visibility =='
Invoke-RestMethod -Method Post -Uri "$S/posts" -ContentType 'application/json' -Headers $H -Body '{"body":"hello-public-post","visibility":"PUBLIC"}' -WebSession $SA | Out-Null
Invoke-RestMethod -Method Post -Uri "$S/posts" -ContentType 'application/json' -Headers $H -Body '{"body":"friends-only-post","visibility":"FRIENDS"}' -WebSession $SA | Out-Null
$feed = Invoke-RestMethod "$S/feed" -WebSession $SB
$pubSeen = @($feed.data | Where-Object { $_.body -eq 'hello-public-post' }).Count -ge 1
$friSeen = @($feed.data | Where-Object { $_.body -eq 'friends-only-post' }).Count -ge 1
Check 'B feed shows A public post' $pubSeen
Check 'B feed shows A friend-only post (are friends)' $friSeen

Write-Host '== M5.7 group create + join (FREE) =='
$grp = Invoke-RestMethod -Method Post -Uri "$S/groups" -ContentType 'application/json' -Headers $H -Body ('{"name":"' + $groupName + '","description":"tech","visibility":"PUBLIC","joinPolicy":"FREE"}') -WebSession $SA
$gid = $grp.data.id
$join = Invoke-RestMethod -Method Post -Uri "$S/groups/$gid/join" -Headers $H -WebSession $SB
Check 'group created and B joined (ACTIVE)' ($gid -gt 0 -and $join.data.status -eq 'ACTIVE')

Write-Host '== M5.8 anonymous topic + reply, anonymity enforced =='
$topic = Invoke-RestMethod -Method Post -Uri "$S/groups/$gid/topics" -ContentType 'application/json' -Headers $H -Body '{"title":"secret","body":"anon post","anonymous":true}' -WebSession $SA
$tid = $topic.data.id
$topics = Invoke-RestMethod "$S/groups/$gid/topics" -WebSession $SB
$anonOk = @($topics.data | Where-Object { $_.id -eq $tid })[0].author.userId -eq ''
Check 'anonymous topic hides author userId for readers' $anonOk
Invoke-RestMethod -Method Post -Uri "$S/topics/$tid/replies" -ContentType 'application/json' -Headers $H -Body '{"body":"nice","anonymous":false}' -WebSession $SB | Out-Null
$replies = Invoke-RestMethod "$S/topics/$tid/replies" -WebSession $SA
Check 'reply visible with real author (non-anon)' (@($replies.data).Count -ge 1 -and @($replies.data)[0].author.userId -eq $Bid)

Write-Host '== M5.9 private mail + read state =='
$mail = Invoke-RestMethod -Method Post -Uri "$S/mail" -ContentType 'application/json' -Headers $H -Body ('{"toUserId":"' + $Bid + '","subject":"hello","body":"are you free?"}') -WebSession $SA
$thid = $mail.data.threadId
$threads = Invoke-RestMethod "$S/mail/threads" -WebSession $SB
Check 'B sees thread from A' (@($threads.data | Where-Object { $_.threadId -eq $thid }).Count -ge 1)
$msgs = Invoke-RestMethod "$S/mail/threads/$thid/messages" -WebSession $SB
Check 'B reads messages (marks read)' (@($msgs.data).Count -ge 1)
$threads2 = Invoke-RestMethod "$S/mail/threads" -WebSession $SB
$unread = @($threads2.data | Where-Object { $_.threadId -eq $thid })[0].unread
Check 'thread unread cleared after read' ($unread -eq 0)

Write-Host '== M5.10 resume save + item =='
Invoke-RestMethod -Method Put -Uri "$S/resume" -ContentType 'application/json' -Headers $H -Body '{"headline":"Senior Engineer","summary":"10y"}' -WebSession $SA | Out-Null
Invoke-RestMethod -Method Post -Uri "$S/resume/items" -ContentType 'application/json' -Headers $H -Body '{"kind":"WORK","title":"Acme Corp","startYear":2018,"endYear":2024}' -WebSession $SA | Out-Null
$resume = Invoke-RestMethod "$S/resume" -WebSession $SA
Check 'resume headline + item persisted' ($resume.data.resume.headline -eq 'Senior Engineer' -and @($resume.data.items).Count -ge 1)

Write-Host '== M5.11 platform ban blocks social endpoint (403) =='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"admin","password":"admin-Startup-2026"}' -SessionVariable ADM | Out-Null
Invoke-RestMethod -Method Post -Uri "$BE/enterprise/admin/account/users/$Bid/ban" -ContentType 'application/json' -Headers $H -Body '{"reason":"smoke"}' -WebSession $ADM | Out-Null
try {
  Invoke-RestMethod "$S/feed" -WebSession $SB | Out-Null
  Check 'banned user blocked from social' $false
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  Check 'banned user gets 403 on social' ($code -eq 403)
}
Invoke-RestMethod -Method Post -Uri "$BE/enterprise/admin/account/users/$Bid/unban" -ContentType 'application/json' -Headers $H -Body '{}' -WebSession $ADM | Out-Null

Write-Host ("== M5 DONE pass=" + $pass + " fail=" + $fail + " ==")
if ($fail -gt 0) { exit 1 }
