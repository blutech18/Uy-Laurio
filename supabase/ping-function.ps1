# Health-checks the deployed send-notification function.
#
# Uses limit=0 so authorization and the code path are exercised without
# claiming or sending any queued notification.
#
#   powershell -NoProfile -File supabase/ping-function.ps1
#   powershell -NoProfile -File supabase/ping-function.ps1 -Limit 25   # actually send

param([int]$Limit = 0, [string]$Action = "")

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$projectRef = "psqevqokpkatfdremxtm"

foreach ($line in Get-Content (Join-Path $root ".env")) {
    if ($line -match '^\s*CRON_SECRET\s*=\s*(.+)\s*$') { $cronSecret = $Matches[1].Trim() }
}
if (-not $cronSecret) { throw "CRON_SECRET missing from .env - run set-secrets.ps1 first" }

$body = @{ limit = $Limit }
if ($Action) { $body.action = $Action }

try {
    $response = Invoke-RestMethod `
        -Uri "https://$projectRef.functions.supabase.co/send-notification" `
        -Method Post `
        -Headers @{ "x-cron-secret" = $cronSecret; "Content-Type" = "application/json" } `
        -Body ($body | ConvertTo-Json -Compress)
    $response | ConvertTo-Json -Compress
}
catch {
    Write-Output "HTTP error: $($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Output $_.ErrorDetails.Message }
    exit 1
}
