param([switch]$Open)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($launcher) { & $launcher.Source -3 build.py } else { python build.py }
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. See README.md for dependency installation.' }
    if ($launcher) { & $launcher.Source -3 verify.py } else { python verify.py }
    if ($LASTEXITCODE -ne 0) { throw 'Verification failed.' }
    if ($Open) { Start-Process (Join-Path $PSScriptRoot 'output\index.html') }
} finally { Pop-Location }
