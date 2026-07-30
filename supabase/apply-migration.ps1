# Applies one migration file to the hosted project via the management API.
# Sends the SQL as a UTF-8 JSON body so dollar-quoted blocks and comments
# survive intact.
#
#   powershell -NoProfile -File supabase/apply-migration.ps1 -Name 0010_notification_claim.sql

param([Parameter(Mandatory = $true)][string]$Name)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$projectRef = "psqevqokpkatfdremxtm"
$path = Join-Path $root (Join-Path "supabase\migrations" $Name)

if (-not (Test-Path $path)) { throw "Migration not found: $path" }

foreach ($line in Get-Content (Join-Path $root ".env")) {
    if ($line -match '^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.+)\s*$') { $token = $Matches[1].Trim() }
}
if (-not $token) { throw "SUPABASE_ACCESS_TOKEN missing from .env" }

$sql = [System.IO.File]::ReadAllText($path)
$payload = [pscustomobject]@{ query = $sql } | ConvertTo-Json -Compress -Depth 3
$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)

Write-Output ("Applying {0} ({1} chars of SQL) ..." -f $Name, $sql.Length)

try {
    $response = Invoke-RestMethod `
        -Uri "https://api.supabase.com/v1/projects/$projectRef/database/query" `
        -Method Post `
        -Headers @{ Authorization = "Bearer $token" } `
        -ContentType "application/json; charset=utf-8" `
        -Body $bytes
    Write-Output "OK"
    if ($response) { $response | ConvertTo-Json -Depth 5 -Compress }
}
catch {
    Write-Output "HTTP error: $($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Output $_.ErrorDetails.Message }
    exit 1
}
