$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$raw = Join-Path $root 'data/raw'
$archive = Join-Path $raw 'ai4i2020.zip'
$csv = Join-Path $raw 'ai4i2020/ai4i2020.csv'
$expected = 'DC6630CD9B1F0F853922FAD78A1B6436570D3F1EC863F1DD5C4340AC56BC8A8E'
New-Item -ItemType Directory -Force -Path $raw | Out-Null
if (Test-Path -LiteralPath $csv) {
    if ((Get-FileHash -LiteralPath $csv).Hash -ne $expected) { throw 'Existing CSV differs from locked data; not overwriting.' }
    Write-Output 'PASS: locked dataset already present.'
    exit 0
}
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri 'https://archive.ics.uci.edu/static/public/601/ai4i+2020+predictive+maintenance+dataset.zip' -OutFile $archive -UseBasicParsing
}
if ((Get-FileHash -LiteralPath $archive).Hash -ne 'F601F14294BCF190F9D720676B7F0AEA46A26CDE9AB8EBC7B4F8174D9D26B252') {
    throw 'Archive checksum mismatch; inspect upstream change before updating the lock.'
}
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $raw 'ai4i2020')
if ((Get-FileHash -LiteralPath $csv).Hash -ne $expected) { throw 'CSV checksum mismatch' }
Write-Output 'PASS: downloaded and verified official UCI dataset.'
