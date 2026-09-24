param(
  [string]$ZipPath = 'C:\Users\username\Downloads\llama-b10948-win-cpu-x64.zip',
  [string]$ModelPath = (Join-Path $PSScriptRoot 'local-llm\models\qwen2.5-0.5b-instruct-q4_k_m.gguf')
)

$bin = Join-Path $PSScriptRoot 'local-llm\bin'
$exe = Join-Path $bin 'llama-server.exe'
$expectedModelHash = '74A4DA8C9FDBCD15BD1F6D01D621410D31C6FC00986F5EB687824E7B93D7A9DB'

foreach ($path in @($ZipPath, $exe, $ModelPath)) {
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required local LLM file is missing: $path"
  }
}

$modelHash = (Get-FileHash -LiteralPath $ModelPath -Algorithm SHA256).Hash
if ($modelHash -ne $expectedModelHash) {
  throw "Unexpected Qwen GGUF SHA-256: $modelHash"
}

$versionLines = @(& $exe --version 2>&1 | ForEach-Object { $_.ToString() })
$version = ($versionLines -join [Environment]::NewLine).Trim()
if ($LASTEXITCODE -ne 0 -or !$version) {
  throw 'llama-server --version failed.'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
$mismatches = [System.Collections.Generic.List[string]]::new()
$checked = 0
try {
  foreach ($entry in $archive.Entries | Where-Object { $_.FullName -and !$_.FullName.EndsWith('/') }) {
    $runtimePath = Join-Path $bin $entry.FullName
    if (!(Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
      $mismatches.Add("missing: $($entry.FullName)")
      continue
    }
    $stream = $entry.Open()
    try {
      $archiveHash = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash
    } finally {
      $stream.Dispose()
    }
    $runtimeFile = Get-Item -LiteralPath $runtimePath
    $runtimeHash = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash
    $checked++
    if ($entry.Length -ne $runtimeFile.Length -or $archiveHash -ne $runtimeHash) {
      $mismatches.Add("different: $($entry.FullName)")
    }
  }
} finally {
  $archive.Dispose()
}

if ($mismatches.Count) {
  throw "llama.cpp archive mismatch: $($mismatches -join ', ')"
}

Write-Output "llama.cpp archive match: $checked entries"
Write-Output "runtime: $version"
Write-Output "model: $ModelPath"
Write-Output "model SHA-256: $modelHash"
