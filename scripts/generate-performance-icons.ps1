$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$publicDir = Join-Path $PSScriptRoot '..\frontend\public'
$stops = @(
  @{ At = 0.00; Color = '#ef6b70' },
  @{ At = 0.24; Color = '#f49a62' },
  @{ At = 0.48; Color = '#f5cc5b' },
  @{ At = 0.72; Color = '#a7cf75' },
  @{ At = 1.00; Color = '#38c978' }
)

function Get-GradientColor([double] $position) {
  for ($index = 0; $index -lt $stops.Count - 1; $index++) {
    $left = $stops[$index]
    $right = $stops[$index + 1]
    if ($position -le $right.At) {
      $mix = ($position - $left.At) / ($right.At - $left.At)
      $from = [System.Drawing.ColorTranslator]::FromHtml($left.Color)
      $to = [System.Drawing.ColorTranslator]::FromHtml($right.Color)
      return [System.Drawing.Color]::FromArgb(
        [int][Math]::Round($from.R + ($to.R - $from.R) * $mix),
        [int][Math]::Round($from.G + ($to.G - $from.G) * $mix),
        [int][Math]::Round($from.B + ($to.B - $from.B) * $mix)
      )
    }
  }
  return [System.Drawing.ColorTranslator]::FromHtml($stops[-1].Color)
}

foreach ($icon in @(
  @{ Name = 'performance-icon-64.png'; Size = 64 },
  @{ Name = 'logo192.png'; Size = 192 },
  @{ Name = 'logo512.png'; Size = 512 }
)) {
  $bitmap = [System.Drawing.Bitmap]::new($icon.Size, $icon.Size)
  try {
    for ($x = 0; $x -lt $icon.Size; $x++) {
      $color = Get-GradientColor ($x / ($icon.Size - 1))
      for ($y = 0; $y -lt $icon.Size; $y++) {
        $bitmap.SetPixel($x, $y, $color)
      }
    }
    $bitmap.Save((Join-Path $publicDir $icon.Name), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
}
