# Turns ON "Confirm email" and points Supabase Auth at a real SMTP provider, so
# sign-up confirmation links and password-reset links actually reach inboxes.
#
# Why this is needed: Supabase's built-in mail sender only delivers to project
# team members and is rate-limited to a few emails per hour. Anyone else (every
# real client) never receives the confirmation or reset link.
#
# Prerequisites (.env, gitignored):
#   SUPABASE_ACCESS_TOKEN=...      personal access token
#   BREVO_SMTP_LOGIN=...           Brevo SMTP login (Brevo > SMTP & API > SMTP)
#   BREVO_SMTP_KEY=...             Brevo SMTP key (not the v3 API key)
#   BREVO_FROM_EMAIL=you@gmail.com a sender address verified in Brevo
#   SITE_URL=https://your-site.example   (where confirmation links should land)
#
#   powershell -NoProfile -File supabase/configure-auth-email.ps1

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $root ".env"
$projectRef = "psqevqokpkatfdremxtm"

$vars = @{}
foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') { $vars[$Matches[1]] = $Matches[2] }
}
foreach ($required in "SUPABASE_ACCESS_TOKEN", "BREVO_SMTP_LOGIN", "BREVO_SMTP_KEY", "BREVO_FROM_EMAIL", "SITE_URL") {
    if (-not $vars[$required]) { throw "$required missing from .env" }
}

$confirmationHtml = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "templates/confirmation.html"))
$recoveryHtml     = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "templates/recovery.html"))
$site = $vars["SITE_URL"].TrimEnd("/")

$body = @{
    mailer_autoconfirm        = $false
    external_email_enabled    = $true
    site_url                  = $site
    uri_allow_list            = ($site + "," + $site + "/**,http://localhost:5173,http://localhost:3000")
    smtp_host                 = "smtp-relay.brevo.com"
    smtp_port                 = "587"
    smtp_user                 = $vars["BREVO_SMTP_LOGIN"]
    smtp_pass                 = $vars["BREVO_SMTP_KEY"]
    smtp_admin_email          = $vars["BREVO_FROM_EMAIL"]
    smtp_sender_name          = "Uy-Laurio Law Office"
    mailer_subjects_confirmation = "Confirm your Uy-Laurio portal account"
    mailer_subjects_recovery     = "Reset your Uy-Laurio portal password"
    mailer_templates_confirmation_content = $confirmationHtml
    mailer_templates_recovery_content     = $recoveryHtml
} | ConvertTo-Json

Invoke-RestMethod -Method Patch `
    -Uri "https://api.supabase.com/v1/projects/$projectRef/config/auth" `
    -Headers @{ Authorization = "Bearer $($vars['SUPABASE_ACCESS_TOKEN'])"; "Content-Type" = "application/json" } `
    -Body $body | Out-Null

Write-Output "Auth email configured: confirmation required, SMTP via Brevo."
