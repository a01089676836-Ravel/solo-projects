$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pythonCandidates = @(
    "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
)
$pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
if ($pythonCommand -and $pythonCommand.Source -notlike '*WindowsApps*') {
    $pythonCandidates += $pythonCommand.Source
}
$pythonPath = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $pythonPath) { throw 'Python 3.11+ is required. Install Python and retry.' }
if (-not (Test-Path -LiteralPath '.\data\events.sqlite')) { throw 'Database missing. Run download.ps1, then: python pipeline.py all' }
if (-not (Test-Path -LiteralPath '.\reports\analysis.json')) { throw 'Report missing. Run: python pipeline.py analyze; python pipeline.py verify' }
Write-Host 'Open http://127.0.0.1:8770 in your browser. Press Ctrl+C here to stop.'
& $pythonPath pipeline.py serve
if ($LASTEXITCODE -ne 0) { throw "Server exited with code $LASTEXITCODE" }
