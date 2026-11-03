$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location "$PSScriptRoot\..\backend"
$dir = 'prisma\migrations\0001_init'
$out = pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script 2>$null
if (-not $out -or $out.Count -lt 100) { throw "migrate diff output empty (got $($out.Count) lines)" }
# strip literal DEFAULT clauses from TEXT/BLOB column lines (MySQL error 1101)
$fixed = foreach ($l in $out) {
  if ($l -match '^\s+`\w+`\s+(TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|BLOB)\b' -and $l -match 'DEFAULT') {
    $l -replace "\s+DEFAULT\s+'[^']*'", ''
  } else { $l }
}
[IO.File]::WriteAllLines("$PWD\$dir\migration.sql", $fixed, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "sql lines: $($fixed.Count)"
# sanity: no mojibake markers and no TEXT defaults left
$check = Get-Content "$PWD\$dir\migration.sql" -Encoding UTF8
Write-Output "suspect lines: $(@($check | Where-Object { $_ -match '\?,' -and $_ -match 'DEFAULT' }).Count)"
Write-Output "text defaults left: $(@($check | Where-Object { $_ -match '^\s+`\w+`\s+(TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|BLOB)\b.*DEFAULT' }).Count)"
