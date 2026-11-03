# 生成增量迁移 SQL：对比线上库与 schema.prisma 的差异，产出 migrations/<Name>/migration.sql
# 用法：powershell -File scripts/gen-migration-delta.ps1 -Name 0002_account
param(
  [Parameter(Mandatory = $true)][string]$Name
)
$ErrorActionPreference = 'Stop'
# Prisma 输出是 UTF-8，PowerShell 默认代码页会把它解码坏（中文默认值毁引号）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location "$PSScriptRoot\..\backend"

$dbLine = Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
$dbUrl = $dbLine.Substring(13).Trim().Trim('"')
$out = pnpm exec prisma migrate diff `
  --from-url $dbUrl `
  --to-schema-datamodel prisma/schema.prisma `
  --script 2>$null

if (-not $out -or ($out -join "`n").Trim().Length -eq 0) {
  Write-Host "NO_CHANGES"
  exit 0
}

# 剥掉 TEXT/BLOB 列的字面 DEFAULT（MySQL 1101：BLOB/TEXT 不能带默认值；Prisma Client 会在应用层补）
# 两种形态：建表列定义 `col` TEXT ... DEFAULT 'x'；回补语句 MODIFY `col` TEXT ... DEFAULT ''
$fixed = @()
foreach ($l in $out) {
  if ($l -match '(TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|BLOB)\b' -and $l -match "DEFAULT\s+'") {
    $l = $l -replace "\s+DEFAULT\s+'[^']*'", ''
  }
  $fixed += $l
}

$dir = "prisma\migrations\$Name"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
[IO.File]::WriteAllLines("$PWD\$dir\migration.sql", $fixed, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "WROTE $dir\migration.sql lines=$($fixed.Count)"
