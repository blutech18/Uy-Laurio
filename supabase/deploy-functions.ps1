# Deploys the Edge Functions to the hosted project.
#
# Reads SUPABASE_ACCESS_TOKEN from .env so the token never has to be typed on
# the command line (and never lands in shell history). .env is gitignored.
#
#   powershell -NoProfile -File supabase/deploy-functions.ps1

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $root ".env"
$projectRef = "psqevqokpkatfdremxtm"

if (-not (Test-Path $envFile)) { throw ".env not found at $envFile" }

foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.+)\s*$') {
        $env:SUPABASE_ACCESS_TOKEN = $Matches[1].Trim()
    }
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
    throw "SUPABASE_ACCESS_TOKEN is not set in .env"
}

Write-Output "Token loaded (length $($env:SUPABASE_ACCESS_TOKEN.Length)). Deploying to $projectRef ..."

Push-Location $root
try {
    supabase functions deploy send-notification --project-ref $projectRef
    supabase functions deploy admin-create-client --project-ref $projectRef
}
finally {
    Pop-Location
}
