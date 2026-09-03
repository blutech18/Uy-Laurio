# Builds the brand assets in public/brand from the official logo artwork the
# client supplied (docs/revisions/images/image12.jpg).
#
# The source is dark ink on a solid white background, so the background is
# removed by "unmultiplying" each pixel from white:
#     alpha = 1 - min(r,g,b)/255          (ink coverage)
#     ink   = (pixel - white*(1-alpha)) / alpha
# Compositing the result back over white reproduces the original exactly, and
# the edges stay smooth instead of showing the halo a flat colour-key leaves.
#
# Two variants are produced because the crest sits on both light surfaces and
# the dark navigation bar / maroon panel:
#   *-color.png  full-colour ink, transparent background
#   *-white.png  white ink, same coverage (for dark surfaces)
#
# Re-run with:  pwsh -File supabase/../scripts/build-brand-assets.ps1
# (safe to re-run; it only writes into public/brand)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root   = Split-Path -Parent $PSScriptRoot
$src    = Join-Path $root 'docs\revisions\images\image12.jpg'
$outDir = Join-Path $root 'public\brand'

if (-not (Test-Path $src)) { throw "Source artwork not found: $src" }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# ── Load and normalise to 32bpp ARGB ────────────────────────────────────────
$orig = [System.Drawing.Image]::FromFile($src)
$w = $orig.Width; $h = $orig.Height
$bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($orig, 0, 0, $w, $h)
$g.Dispose(); $orig.Dispose()
Write-Host "source: ${w}x${h}"

$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$buf = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
$bmp.UnlockBits($data)
$bmp.Dispose()

# ── Ink map: coverage per pixel (0..255) ────────────────────────────────────
# BGRA byte order. Anything brighter than the threshold counts as background.
$inkThreshold = 240
$cov = New-Object byte[] ($w * $h)
$rowInk = New-Object int[] $h
$colInk = New-Object int[] $w

for ($y = 0; $y -lt $h; $y++) {
  $rowBase = $y * $stride
  for ($x = 0; $x -lt $w; $x++) {
    $i = $rowBase + ($x * 4)
    $b = $buf[$i]; $gr = $buf[$i + 1]; $r = $buf[$i + 2]
    $min = $b; if ($gr -lt $min) { $min = $gr }; if ($r -lt $min) { $min = $r }
    if ($min -lt $inkThreshold) {
      $a = 255 - $min
      $cov[($y * $w) + $x] = [byte]$a
      $rowInk[$y]++
      $colInk[$x]++
    }
  }
}

# ── Find the emblem / wordmark split ────────────────────────────────────────
# Rows with almost no ink separate the crest from the "UY-LAURIO" wordmark.
$minRowInk = [Math]::Max(2, [int]($w * 0.002))
$contentRows = 0..($h - 1) | Where-Object { $rowInk[$_] -ge $minRowInk }
if (-not $contentRows) { throw 'No ink detected - check the threshold.' }
$top = $contentRows[0]; $bottom = $contentRows[-1]

# longest blank run strictly inside the content band = the gap
$bestStart = -1; $bestLen = 0; $runStart = -1
for ($y = $top; $y -le $bottom; $y++) {
  if ($rowInk[$y] -lt $minRowInk) {
    if ($runStart -lt 0) { $runStart = $y }
  } elseif ($runStart -ge 0) {
    $len = $y - $runStart
    if ($len -gt $bestLen) { $bestLen = $len; $bestStart = $runStart }
    $runStart = -1
  }
}
Write-Host "content rows: $top..$bottom ; widest gap: $bestStart (+$bestLen)"

$crestTop = $top
$crestBottom = if ($bestLen -ge 8) { $bestStart - 1 } else { $bottom }

function Get-ColBounds([int]$y0, [int]$y1) {
  $lo = -1; $hi = -1
  for ($x = 0; $x -lt $w; $x++) {
    $any = $false
    for ($y = $y0; $y -le $y1; $y++) {
      if ($cov[($y * $w) + $x] -gt 0) { $any = $true; break }
    }
    if ($any) { if ($lo -lt 0) { $lo = $x }; $hi = $x }
  }
  return @($lo, $hi)
}

function Save-Crop {
  param([int]$x0, [int]$y0, [int]$x1, [int]$y1, [bool]$White, [string]$Path)

  $cw = $x1 - $x0 + 1
  $ch = $y1 - $y0 + 1
  $out = New-Object System.Drawing.Bitmap $cw, $ch, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $od = $out.LockBits(
    (New-Object System.Drawing.Rectangle 0, 0, $cw, $ch),
    [System.Drawing.Imaging.ImageLockMode]::WriteOnly,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $ostride = $od.Stride
  $obuf = New-Object byte[] ($ostride * $ch)

  for ($y = 0; $y -lt $ch; $y++) {
    $sy = $y0 + $y
    $srcRow = $sy * $stride
    $dstRow = $y * $ostride
    for ($x = 0; $x -lt $cw; $x++) {
      $sx = $x0 + $x
      $a = $cov[($sy * $w) + $sx]
      $o = $dstRow + ($x * 4)
      if ($a -eq 0) { continue }   # leave fully transparent
      if ($White) {
        $obuf[$o] = 255; $obuf[$o + 1] = 255; $obuf[$o + 2] = 255; $obuf[$o + 3] = $a
      } else {
        $i = $srcRow + ($sx * 4)
        $af = $a / 255.0
        # unmultiply from white, clamped
        foreach ($c in 0..2) {
          $v = ($buf[$i + $c] - (255.0 * (1.0 - $af))) / $af
          if ($v -lt 0) { $v = 0 } elseif ($v -gt 255) { $v = 255 }
          $obuf[$o + $c] = [byte][Math]::Round($v)
        }
        $obuf[$o + 3] = $a
      }
    }
  }

  [System.Runtime.InteropServices.Marshal]::Copy($obuf, 0, $od.Scan0, $obuf.Length)
  $out.UnlockBits($od)
  $out.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host ("wrote {0}  ({1}x{2})" -f (Split-Path -Leaf $Path), $cw, $ch)
  $out.Dispose()
}

$cb = Get-ColBounds $crestTop $crestBottom
Save-Crop $cb[0] $crestTop $cb[1] $crestBottom $false (Join-Path $outDir 'uy-laurio-crest.png')
Save-Crop $cb[0] $crestTop $cb[1] $crestBottom $true  (Join-Path $outDir 'uy-laurio-crest-white.png')

$fb = Get-ColBounds $top $bottom
Save-Crop $fb[0] $top $fb[1] $bottom $false (Join-Path $outDir 'uy-laurio-lockup.png')
Save-Crop $fb[0] $top $fb[1] $bottom $true  (Join-Path $outDir 'uy-laurio-lockup-white.png')

# ── Square app icon: crest centred on the brand maroon, for the browser tab ──
$crestPath = Join-Path $outDir 'uy-laurio-crest-white.png'
$crest = [System.Drawing.Image]::FromFile($crestPath)
$side = 512
$pad = [int]($side * 0.12)
$icon = New-Object System.Drawing.Bitmap $side, $side, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$ig = [System.Drawing.Graphics]::FromImage($icon)
$ig.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$ig.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$brand = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 138, 28, 31))
$ig.FillEllipse($brand, 0, 0, $side - 1, $side - 1)

# fit the crest inside the padded box, preserving aspect
$avail = $side - (2 * $pad)
$scale = [Math]::Min($avail / $crest.Width, $avail / $crest.Height)
$dw = [int]($crest.Width * $scale); $dh = [int]($crest.Height * $scale)
$ig.DrawImage($crest, [int](($side - $dw) / 2), [int](($side - $dh) / 2), $dw, $dh)
$ig.Dispose(); $brand.Dispose(); $crest.Dispose()
$icon.Save((Join-Path $outDir 'uy-laurio-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host ("wrote uy-laurio-icon.png  ({0}x{0})" -f $side)
$icon.Dispose()

Write-Host 'done.'
