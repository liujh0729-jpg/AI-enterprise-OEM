$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# 创意社区端到端冒烟：绑 Key → 取可运行模板 → 站内运行 → 轮询产物 → 发布 → 审核 → 推荐发奖 → 对账。
#
# 需要真实环境：本地后端（1690）+ 已执行 0012 迁移 + 一把**有效的 Comfy Cloud API Key**
# （上游 API 访问要求付费订阅，免费套餐不含；401/429 会被后端原样翻译成中文提示）。
#
#   $env:COMFY_SMOKE_KEY = '……'   ; pnpm i ; pnpm dev ; powershell -File scripts/smoke-creative-community.ps1
#
# 没有 Key 时想验证「闸门与链路形状」：把后端指向回环 mock 上游
# （backend 侧设 COMFY_CLOUD_BASE_URL=http://127.0.0.1:<port>，仅开发环境允许），
# 再给一个占位 Key 即可跑通提交与轮询之外的分支。
# 未提供 COMFY_SMOKE_KEY 时本脚本直接 SKIP 并返回 0，不产生假绿。
$base = 'http://127.0.0.1:1690'
$BE = "$base/api/backend"
$H = @{ Origin = 'http://127.0.0.1:1690' }
$pass = 0; $fail = 0
function Check($name, $cond) {
  if ($cond) { Write-Host "PASS: $name"; $script:pass++ }
  else { Write-Host "FAIL: $name"; $script:fail++ }
}
$key = [string]$env:COMFY_SMOKE_KEY
if (-not $key) {
  Write-Host 'SKIP: 未设置 $env:COMFY_SMOKE_KEY（创意社区运行必须用真实 Comfy Cloud Key 或回环 mock 上游）'
  exit 0
}
$waitSec = [int]$(if ($env:COMFY_SMOKE_WAIT_SEC) { $env:COMFY_SMOKE_WAIT_SEC } else { 420 })
$rnd = Get-Random -Minimum 1000 -Maximum 999999
$user = "comm$rnd"
$publishedCode = ''

Write-Host '== C.1 登录（平台管理员 + 新建作者账号）=='
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"admin","password":"admin-Startup-2026"}' -SessionVariable adminSess | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/register" -ContentType 'application/json' -Headers $H -Body ('{"mode":"USERNAME","username":"' + $user + '","password":"Community-1234"}') | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body ('{"account":"' + $user + '","password":"Community-1234"}') -SessionVariable UA | Out-Null
Check 'author login ok' ($UA -ne $null)

try {
  Write-Host '== C.2 未连接时不给运行（默认最严：无 Key 直接拒）=='
  $st0 = Invoke-RestMethod "$BE/enterprise/community/comfy/status" -WebSession $UA
  if ($st0.data.connected) {
    Invoke-RestMethod -Method Delete "$BE/enterprise/community/comfy/credential" -Headers $H -WebSession $UA | Out-Null
    $st0 = Invoke-RestMethod "$BE/enterprise/community/comfy/status" -WebSession $UA
  }
  Check 'status starts unbound' ($st0.data.connected -eq $false)
  $runnable = Invoke-RestMethod "$BE/enterprise/community/workflows?runnable=true&pageSize=5" -WebSession $UA
  $pick = @($runnable.data.list | Where-Object { $_.runnable } | Select-Object -First 1)
  Check '社区有可直接运行的模板' ($pick.Count -eq 1)
  $denied = $null
  try { Invoke-RestMethod -Method Post "$BE/enterprise/community/workflows/$($pick[0].code)/run" -ContentType 'application/json' -Headers $H -Body '{"inputs":{}}' -WebSession $UA | Out-Null }
  catch { $denied = $_.ErrorDetails.Message }
  Check '无 Key 运行被拒并给出连接引导' ([string]$denied -match 'Comfy Cloud')

  Write-Host '== C.3 绑定 Key：只回掩码，明文不回传也不留档 =='
  $bound = Invoke-RestMethod -Method Post "$BE/enterprise/community/comfy/credential" -ContentType 'application/json' -Headers $H -Body ('{"apiKey":"' + $key + '"}') -WebSession $UA
  Check 'connected=true' ($bound.data.connected -eq $true)
  Check '返回的是掩码' ([string]$bound.data.keyMask -match '\u2026')
  Check '响应里查不到明文 Key' (([string]($bound | ConvertTo-Json -Depth 6)) -notmatch [regex]::Escape($key))
  $tested = Invoke-RestMethod -Method Post "$BE/enterprise/community/comfy/credential/test" -Headers $H -WebSession $UA
  Check '再次连通性校验通过' ($tested.data.connected -eq $true)

  Write-Host '== C.4 站内运行 → 轮询 → 产物转存本站 OSS 并入数字资产 =='
  $run = Invoke-RestMethod -Method Post "$BE/enterprise/community/workflows/$($pick[0].code)/run" -ContentType 'application/json' -Headers $H -Body '{"inputs":{}}' -WebSession $UA
  Check '运行已受理（拿到 jobId）' ([string]$run.data.jobId -ne '')
  $deadline = (Get-Date).AddSeconds($waitSec)
  $final = $run.data
  while ($final.active -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 10
    $final = (Invoke-RestMethod "$BE/enterprise/community/runs/$($run.data.id)" -WebSession $UA).data
    Write-Host ("   status={0} progress={1}/{2} queue={3}" -f $final.status, $final.progressCurrent, $final.progressTotal, $final.queuePosition)
  }
  Check "运行进入终态（$($final.status)）" (-not $final.active)
  if ($final.status -eq 'succeeded') {
    $outputs = @($final.outputs)
    Check '产物已转存（至少 1 个）' ($outputs.Count -ge 1)
    Check '产物落的是本站对象键，不是上游短命签名 URL' (@($outputs | Where-Object { [string]$_.url -match 'cloud\.comfy\.org' -or [string]$_.ossKey -eq '' }).Count -eq 0)
    Check '产物登记进了数字资产台账' (@($outputs | Where-Object { $_.assetId -gt 0 }).Count -ge 1)
  } else {
    Write-Host "   说明：$($final.errorText)"
    Check '失败/取消也带回可执行的中文原因' ([string]$final.errorText -ne '')
  }

  Write-Host '== C.5 发布（核心节点骨架）→ 后台待审队列看得到 =='
  $graph = @{
    '1' = @{ class_type = 'CheckpointLoaderSimple'; inputs = @{ ckpt_name = 'sd_xl_base_1.0.safetensors' } }
    '2' = @{ class_type = 'CLIPTextEncode'; inputs = @{ clip = @('1', 1); text = 'a red cube on white background' } }
    '3' = @{ class_type = 'CLIPTextEncode'; inputs = @{ clip = @('1', 1); text = 'lowres, watermark' } }
    '4' = @{ class_type = 'EmptyLatentImage'; inputs = @{ width = 512; height = 512; batch_size = 1 } }
    '5' = @{ class_type = 'KSampler'; inputs = @{ model = @('1', 0); positive = @('2', 0); negative = @('3', 0); latent_image = @('4', 0); seed = 12345; steps = 4; cfg = 4; sampler_name = 'euler'; scheduler = 'normal'; denoise = 1 } }
    '6' = @{ class_type = 'VAEDecode'; inputs = @{ samples = @('5', 0); vae = @('1', 2) } }
    '7' = @{ class_type = 'SaveImage'; inputs = @{ images = @('6', 0); filename_prefix = 'smoke' } }
  }
  $slots = @(@{ key = 'prompt'; label = '提示词'; type = 'text'; nodeId = '2'; field = 'text'; defaultValue = ''; required = $true })
  $body = @{
    title = "冒烟工作流 $rnd"; summary = 'smoke'; description = ''
    category = 'image'; groupLabel = '文生图'; tags = @('smoke'); mediaType = 'image'
    workflowJson = $graph; slots = $slots
  } | ConvertTo-Json -Depth 8 -Compress
  $pub = Invoke-RestMethod -Method Post "$BE/enterprise/community/workflows" -ContentType 'application/json' -Headers $H -Body $body -WebSession $UA
  $publishedCode = [string]$pub.data.code
  Check '发布拿到 code（wf_ 前缀）' ($publishedCode -like 'wf_*')
  Check '新发布默认待审' ($pub.data.status -eq 'PENDING')
  $pending = Invoke-RestMethod "$BE/enterprise/admin/community/workflows?status=PENDING" -WebSession $adminSess
  Check '待审队列里能找到' (@($pending.data.list | Where-Object { $_.code -eq $publishedCode }).Count -eq 1)

  Write-Host '== C.6 越界参数与危险节点都被拒 =='
  $cross = $null
  try { Invoke-RestMethod -Method Post "$BE/enterprise/community/workflows/$publishedCode/run" -ContentType 'application/json' -Headers $H -Body '{"inputs":{"__proto__":"x"}}' -WebSession $UA | Out-Null }
  catch { $cross = $_.ErrorDetails.Message }
  Check '未声明槽位直接拒' ([string]$cross -match '允许修改的范围')
  $evil = @{
    title = "冒烟危险节点 $rnd"; summary = ''; description = ''; category = 'image'; groupLabel = ''
    tags = @(); mediaType = 'image'
    workflowJson = @{ '1' = @{ class_type = 'SubprocessNode'; inputs = @{ cmd = 'id' } } }
    slots = @()
  } | ConvertTo-Json -Depth 8 -Compress
  $rejectedPublish = $null
  try { Invoke-RestMethod -Method Post "$BE/enterprise/community/workflows" -ContentType 'application/json' -Headers $H -Body $evil -WebSession $UA | Out-Null }
  catch { $rejectedPublish = $_.ErrorDetails.Message }
  Check '危险节点发布被拦在门外' ($rejectedPublish -ne $null)

  Write-Host '== C.7 通过 → 推荐 → 发奖，重复推荐不再发第二次 =='
  $approved = Invoke-RestMethod -Method Post "$BE/enterprise/admin/community/workflows/$publishedCode/decide" -ContentType 'application/json' -Headers $H -Body '{"action":"approve","note":"冒烟通过"}' -WebSession $adminSess
  Check '审核通过' ($approved.data.status -eq 'APPROVED')
  $rules = Invoke-RestMethod "$BE/enterprise/admin/community/settings" -WebSession $adminSess
  $recommended = Invoke-RestMethod -Method Post "$BE/enterprise/admin/community/workflows/$publishedCode/decide" -ContentType 'application/json' -Headers $H -Body '{"action":"recommend","note":"冒烟主推"}' -WebSession $adminSess
  Check '推荐进市场' ($recommended.data.status -eq 'RECOMMENDED')
  if ($rules.data.recommendReward -gt 0) {
    Check "首次推荐发奖 $($recommended.data.rewardPoints) 分" ($recommended.data.rewarded -eq $true -and $recommended.data.rewardPoints -eq $rules.data.recommendReward)
    $again = Invoke-RestMethod -Method Post "$BE/enterprise/admin/community/workflows/$publishedCode/decide" -ContentType 'application/json' -Headers $H -Body '{"action":"recommend","note":"重复推荐"}' -WebSession $adminSess
    Check '重复推荐不再发奖（终身幂等）' ($again.data.rewarded -eq $false)
    $stats = Invoke-RestMethod "$BE/enterprise/admin/community/stats" -WebSession $adminSess
    Check '当日发放量对得上奖励金额' ($stats.data.rewardPointsToday -ge $rules.data.recommendReward)
  } else {
    Write-Host '   后台把推荐奖励设成了 0，只验不发奖分支'
    Check '关闭奖励时确实不发' ($recommended.data.rewarded -eq $false)
  }
}
finally {
  Write-Host '== C.8 收尾：下架发布物、解除 Key（不给下一个环境留脏数据）=='
  try {
    if ($publishedCode) {
      Invoke-RestMethod -Method Delete "$BE/enterprise/community/workflows/$publishedCode" -Headers $H -WebSession $UA | Out-Null
    }
    Invoke-RestMethod -Method Delete "$BE/enterprise/community/comfy/credential" -Headers $H -WebSession $UA | Out-Null
    $cleared = Invoke-RestMethod "$BE/enterprise/community/comfy/status" -WebSession $UA
    Check 'Key 已解除' ($cleared.data.connected -eq $false)
  } catch {
    Write-Host "WARN: 收尾失败: $($_.Exception.Message)"
    $script:fail++
  }
}

Write-Host "== CREATIVE COMMUNITY DONE pass=$pass fail=$fail =="
if ($fail -gt 0) { exit 1 }
