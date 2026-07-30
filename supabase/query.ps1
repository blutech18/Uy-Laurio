# Runs a read-only SQL query against the hosted project using the management
# API and the access token in .env. Handy for diagnostics without psql.
#
#   powershell -NoProfile -File supabase/query.ps1 -Sql "select 1"

param([string]$Sql, [string]$File)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$projectRef = "psqevqokpkatfdremxtm"

# -File keeps dollar-quoted SQL ($$ ... $$) intact, which the shell would mangle.
if ($File) {
    $path = if ([System.IO.Path]::IsPathRooted($File)) { $File } else { Join-Path $root $File }
    $Sql = Get-Content $path -Raw
}
if (-not $Sql) { throw "Provide -Sql or -File" }

foreach ($line in Get-Content (Join-Path $root ".env")) {
    if ($line -match '^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.+)\s*$') { $token = $Matches[1].Trim() }
}
if (-not $token) { throw "SUPABASE_ACCESS_TOKEN missing from .env" }

$payload = [pscustomobject]@{ query = $Sql } | ConvertTo-Json -Compress -Depth 3
$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)

try {
    $response = Invoke-RestMethod `
        -Uri "https://api.supabase.com/v1/projects/$projectRef/database/query" `
        -Method Post `
        -Headers @{ Authorization = "Bearer $token" } `
        -ContentType "application/json; charset=utf-8" `
        -Body $bytes
    $response | ConvertTo-Json -Depth 6
}
catch {
    Write-Output "HTTP error: $($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Output $_.ErrorDetails.Message }
    exit 1
}
