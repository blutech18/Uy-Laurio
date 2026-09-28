# Regenerates supabase/setup.sql from the numbered migrations.
# The migrations are the source of truth; setup.sql is only a convenience bundle
# for running everything at once in the Supabase SQL editor.
#
#   powershell -NoProfile -File supabase/build-setup.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root "setup.sql"

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("-- ============================================================================")
$lines.Add("-- Uy-Laurio Legal Portal - FULL SETUP BUNDLE (generated file, do not edit)")
$lines.Add("-- ----------------------------------------------------------------------------")
$lines.Add("-- Concatenation of supabase/migrations/*.sql in order.")
$lines.Add("-- Preferred: 'supabase db push' with the individual migrations.")
$lines.Add("-- Alternative: paste this bundle into the Supabase SQL editor once.")
$lines.Add("-- Regenerate with: powershell -NoProfile -File supabase/build-setup.ps1")
$lines.Add("-- ============================================================================")

Get-ChildItem (Join-Path $root "migrations\*.sql") | Sort-Object Name | ForEach-Object {
    $lines.Add("")
    $lines.Add("-- >>>>>>>>>>>>>>>>>>>> " + $_.Name + " <<<<<<<<<<<<<<<<<<<<")
    $lines.Add("")
    # -Encoding UTF8 matters: without it Get-Content decodes the migration files
    # with the system ANSI codepage, which mangles every non-ASCII character
    # (e.g. "—" becomes "â€”") and ships broken copy into the database.
    $lines.Add((Get-Content $_.FullName -Raw -Encoding UTF8))
}

Set-Content -Path $out -Value $lines -Encoding UTF8
Write-Output ("Wrote {0} ({1} bytes)" -f $out, (Get-Item $out).Length)
