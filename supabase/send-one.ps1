# Delivers a single notification by id, for targeted testing.
#
#   powershell -NoProfile -File supabase/send-one.ps1 -Id <uuid>

param([Parameter(Mandatory = $true)][string]$Id)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$projectRef = "psqevqokpkatfdremxtm"

foreach ($line in Get-Content (Join-Path $root ".env")) {
    if ($line -match '^\s*CRON_SECRET\s*=\s*(.+)\s*$') { $cronSecret = $Matches[1].Trim() }
}
if (-not $cronSecret) { throw "CRON_SECRET missing from .env" }

try {
    $response = Invoke-RestMethod `
        -Uri "https://$projectRef.functions.supabase.co/send-notification" `
        -Method Post `
        -Headers @{ "x-cron-secret" = $cronSecret; "Content-Type" = "application/json" } `
        -Body (@{ id = $Id } | ConvertTo-Json -Compress)
    $response | ConvertTo-Json -Compress
}
catch {
    Write-Output "HTTP error: $($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Output $_.ErrorDetails.Message }
    exit 1
}
