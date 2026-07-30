# Sets the Edge Function secrets that do not depend on a third-party account.
#
# Generates CRON_SECRET on first run and appends it to .env (gitignored) so the
# same value can be used when calling the function from a scheduler.
#
#   powershell -NoProfile -File supabase/set-secrets.ps1
#
# Provider keys are NOT set here — add them yourself once you have the accounts:
#   supabase secrets set RESEND_API_KEY=... --project-ref <ref>
#   supabase secrets set NOTIFY_EMAIL_FROM="..." --project-ref <ref>
#   supabase secrets set SEMAPHORE_API_KEY=... --project-ref <ref>

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $root ".env"
$projectRef = "psqevqokpkatfdremxtm"
$allowedOrigin = "http://localhost:3000"

$lines = Get-Content $envFile
foreach ($line in $lines) {
    if ($line -match '^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.+)\s*$') {
        $env:SUPABASE_ACCESS_TOKEN = $Matches[1].Trim()
    }
    if ($line -match '^\s*CRON_SECRET\s*=\s*(.+)\s*$') {
        $cronSecret = $Matches[1].Trim()
    }
}

if (-not $env:SUPABASE_ACCESS_TOKEN) { throw "SUPABASE_ACCESS_TOKEN missing from .env" }

if (-not $cronSecret) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $cronSecret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    Add-Content -Path $envFile -Value "CRON_SECRET=$cronSecret"
    Write-Output "Generated CRON_SECRET and appended it to .env"
} else {
    Write-Output "Reusing CRON_SECRET from .env"
}

# Provider keys are optional: any of these found in .env get pushed as secrets.
$providerKeys = @(
    "RESEND_API_KEY", "NOTIFY_EMAIL_FROM",
    "SEMAPHORE_API_KEY", "SEMAPHORE_SENDER",
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"
)
$provider = @{}
foreach ($line in $lines) {
    foreach ($key in $providerKeys) {
        if ($line -match ("^\s*" + $key + "\s*=\s*(.+)\s*$")) {
            $provider[$key] = $Matches[1].Trim()
        }
    }
}

Push-Location $root
try {
    supabase secrets set "CRON_SECRET=$cronSecret" --project-ref $projectRef
    supabase secrets set "FUNCTION_ALLOWED_ORIGIN=$allowedOrigin" --project-ref $projectRef

    foreach ($key in $provider.Keys) {
        Write-Output ("Setting {0} (value length {1})" -f $key, $provider[$key].Length)
        supabase secrets set ("{0}={1}" -f $key, $provider[$key]) --project-ref $projectRef
    }
    if ($provider.Count -eq 0) {
        Write-Output "No provider keys in .env - Email/SMS will be marked 'skipped'."
    }
}
finally {
    Pop-Location
}
