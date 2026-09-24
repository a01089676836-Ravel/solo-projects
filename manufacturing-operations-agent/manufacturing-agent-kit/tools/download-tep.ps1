param(
  [string]$Commit = '309b944f35ac440ff0c70616947ffe723c766e14'
)

$root = Split-Path -Parent $PSScriptRoot
$rawRoot = Join-Path $root 'data\raw\tep'
$manifestPath = Join-Path $rawRoot 'manifest.json'
$sourceRoot = "https://media.githubusercontent.com/media/mv-per/tennessee-eastman-dataset/$Commit/simulations"

$files = @(
  [PSCustomObject]@{ mode = 'MODE_1'; relative = 'mode_1/mode1_normal_50.xlsx'; output = 'mode1_normal_50.xlsx' },
  [PSCustomObject]@{ mode = 'MODE_3'; relative = 'mode_3/mode3_normal_50.xlsx'; output = 'mode3_normal_50.xlsx' },
  [PSCustomObject]@{ mode = 'MODE_4'; relative = 'mode_4/mode4_normal_50.xlsx'; output = 'mode4_normal_50.xlsx' }
)

New-Item -ItemType Directory -Path $rawRoot -Force | Out-Null
$records = foreach ($item in $files) {
  $target = Join-Path $rawRoot $item.output
  $url = "$sourceRoot/$($item.relative)"
  if (!(Test-Path -LiteralPath $target -PathType Leaf)) {
    Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
    $action = 'downloaded'
  } else {
    $action = 'reused-existing'
  }
  $file = Get-Item -LiteralPath $target
  [PSCustomObject]@{
    mode = $item.mode
    sourceFile = $item.relative
    url = $url
    localFile = $item.output
    bytes = $file.Length
    sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    action = $action
  }
}

[PSCustomObject]@{
  sourceRepository = 'https://github.com/mv-per/tennessee-eastman-dataset'
  sourceCommit = $Commit
  accessedAt = (Get-Date).ToUniversalTime().ToString('o')
  license = 'MIT as marked by the source repository; verify upstream terms before redistribution'
  datasetScope = 'Normal operation simulations for MODE_1, MODE_3, MODE_4 only'
  files = @($records)
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Output "TEP raw files ready: $($records.Count)"
$records | Format-Table mode,bytes,sha256,action -AutoSize
