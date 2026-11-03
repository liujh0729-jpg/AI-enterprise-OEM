# Smoke: platform-level AIPDD APIKey (base-data channel) + local region dictionary fallback.
# Pure ASCII. Non-destructive: when a platform key is already stored in DB (source=db) the
# mutation steps are skipped, because the plaintext can never be read back to restore it.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$base = 'http://127.0.0.1:1690'
$B = "$base/api/backend"
$H = @{ Origin = 'http://127.0.0.1:1690' }
$FAKE = 'sk-' + ('0123456789abcdef' * 3)
$pass = 0; $fail = 0; $skip = 0
function J($o) { $o | ConvertTo-Json -Compress -Depth 8 }
function Check($name, $cond, $extra) {
  if ($cond) { $script:pass++; Write-Host ("PASS: " + $name) }
  else { $script:fail++; Write-Host ("FAIL: " + $name + " :: " + ($extra | Out-String)) }
}
function Skip($name, $why) { $script:skip++; Write-Host ("SKIP: " + $name + " :: " + $why) }
function Call($method, $uri, $session, $body) {
  try {
    $p = @{ Method = $method; Uri = $uri; Headers = $H; WebSession = $session }
    if ($null -ne $body) {
      $p['Body'] = ($body | ConvertTo-Json -Compress -Depth 8)
      $p['ContentType'] = 'application/json'
    }
    $r = Invoke-RestMethod @p
    return @{ ok = $true; status = 200; data = $r }
  } catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    return @{ ok = $false; status = $status; data = $_.ErrorDetails.Message }
  }
}

Write-Host '== S1 admin login =='
$admin = $null
Invoke-RestMethod -Method Post -Uri "$base/api/auth/local/login" -ContentType 'application/json' -Headers $H -Body '{"account":"admin","password":"admin-Startup-2026"}' -SessionVariable admin | Out-Null
Check 'admin session issued' ($null -ne $admin) ''

Write-Host '== S2 platform key view is masked and shape-stable =='
$view = Call GET "$B/enterprise/admin/account/aipdd-platform-key" $admin $null
Check 'view returns 200' ($view.status -eq 200) $view.status
$d0 = $view.data.data
Check 'view carries configured/source/masked/updatedAt' ($null -ne $d0.PSObject.Properties['configured'] -and $null -ne $d0.PSObject.Properties['source'] -and $null -ne $d0.PSObject.Properties['masked'] -and $null -ne $d0.PSObject.Properties['updatedAt']) (J $d0)
Check 'source is db/env/none' (@('db', 'env', 'none') -contains [string]$d0.source) (J $d0)
if ($d0.configured) {
  Check 'masked keeps only head and tail' ($d0.masked -match '^sk-\*{4}[0-9a-fA-F]{4}$') $d0.masked
} else {
  Check 'unconfigured reports empty mask' ($d0.masked -eq '') (J $d0)
}

Write-Host '== S3 endpoint is admin-only (no session -> 401/403) =='
$anonStatus = 0
try {
  Invoke-RestMethod -Uri "$B/enterprise/admin/account/aipdd-platform-key" -Headers $H | Out-Null
  $anonStatus = 200
} catch {
  if ($_.Exception.Response) { $anonStatus = [int]$_.Exception.Response.StatusCode }
}
Check 'anonymous request rejected' ($anonStatus -eq 401 -or $anonStatus -eq 403) $anonStatus

Write-Host '== S4 malformed key rejected (400, no write) =='
$bad = Call PUT "$B/enterprise/admin/account/aipdd-platform-key" $admin @{ key = 'sk-not-hex' }
Check 'bad format -> 400' ($bad.status -eq 400) $bad.status

Write-Host '== S5 generic settings dump never leaks the cipher =='
$dump = Call GET "$B/enterprise/admin/settings" $admin $null
Check 'settings dump returns 200' ($dump.status -eq 200) $dump.status
Check 'dump has no aipdd_platform_key' (-not ($dump.data.data.PSObject.Properties.Name -contains 'aipdd_platform_key')) (J $dump.data.data)
Check 'dump text carries no sk- key body' (-not ([string]$dump.data | Select-String -Pattern 'aipdd_platform_key')) ''

Write-Host '== S6 generic settings write is refused =='
$ref = Call PUT "$B/enterprise/admin/settings" $admin @{ aipdd_platform_key = 'noop' }
Check 'generic write refused -> 400' ($ref.status -eq 400) ($ref.status.ToString() + ' ' + $ref.data)

Write-Host '== S7 locations dictionary stays reachable (the reported 403 must be gone) =='
$key = Call GET "$B/enterprise/account/aipdd-key" $admin $null
$bound = [bool]$key.data.bound
$loc = Call GET "$B/enterprise/connections/resources/locations" $admin $null
Check 'locations returns 200' ($loc.status -eq 200) ($loc.status.ToString() + ' ' + $loc.data)
$items = @($loc.data.data.list)
Check 'locations list not empty' ($items.Count -gt 0) (J $loc.data.data)
Check 'locations source is known' (@('AIWORKIN', 'LOCAL') -contains [string]$loc.data.data.source) (J $loc.data.data)

if ($d0.source -eq 'db') {
  Skip 'save/clear round trip' 'a platform key is already stored in DB and cannot be restored after overwrite'
} else {
  Write-Host '== S7b save throwaway platform key =='
  $save = Call PUT "$B/enterprise/admin/account/aipdd-platform-key" $admin @{ key = $FAKE }
  Check 'save -> 200' ($save.status -eq 200) ($save.status.ToString() + ' ' + $save.data)
  Check 'save reports source db' ([string]$save.data.data.source -eq 'db') (J $save.data.data)
  Check 'save echoes only mask of throwaway key' ($save.data.data.masked -eq ('sk-****' + $FAKE.Substring($FAKE.Length - 4))) (J $save.data.data)
  Check 'save response never contains the plaintext' (-not ([string]$save.data | Select-String -SimpleMatch $FAKE)) ''
  $dump2 = Call GET "$B/enterprise/admin/settings" $admin $null
  Check 'cipher stays out of generic dump after save' (-not ($dump2.data.data.PSObject.Properties.Name -contains 'aipdd_platform_key')) (J $dump2.data.data)
  $ext = Call GET "$B/enterprise/connections/dictionaries/industry" $admin $null
  Check 'dictionary call authenticates with the platform key' ($ext.status -ne 403) ($ext.status.ToString() + ' ' + $ext.data)

  Write-Host '== S8 clear restores the pre-run state =='
  $clr = Call DELETE "$B/enterprise/admin/account/aipdd-platform-key" $admin $null
  Check 'clear -> 200' ($clr.status -eq 200) ($clr.status.ToString() + ' ' + $clr.data)
  $back = Call GET "$B/enterprise/admin/account/aipdd-platform-key" $admin $null
  if ([string]$d0.source -eq 'env') {
    Check 'env fallback still visible after clear' ($back.data.data.configured -and [string]$back.data.data.source -eq 'env') (J $back.data.data)
  } else {
    Check 'cleared reports unconfigured' (-not $back.data.data.configured) (J $back.data.data)
  }
  if (-not $bound) {
    $loc2 = Call GET "$B/enterprise/connections/resources/locations" $admin $null
    Check 'no platform key + no bound key -> bundled dictionary' ([string]$loc2.data.data.source -eq 'LOCAL' -and @($loc2.data.data.list).Count -gt 0) (J $loc2.data.data)
  } else {
    Skip 'bundled dictionary check' 'this admin already bound a personal AIPDD key'
  }
}

Write-Host ('== AIPDD PLATFORM KEY DONE pass=' + $pass + ' fail=' + $fail + ' skip=' + $skip + ' ==')
if ($fail -gt 0) { exit 1 }
