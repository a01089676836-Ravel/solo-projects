$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
New-Item -ItemType Directory -Path '.\data\raw' -Force | Out-Null
$sourceFile = Join-Path $PSScriptRoot 'data\raw\BPI_Challenge_2019.xes'
$metadataFile = Join-Path $PSScriptRoot 'data\raw\source-metadata.json'
$expectedMD5 = '4eb909242351193a61e1c15b9c3cc814'
$expectedSize = 728558522
if (Test-Path -LiteralPath $sourceFile) {
    if ((Get-Item -LiteralPath $sourceFile).Length -ne $expectedSize -or (Get-FileHash -LiteralPath $sourceFile -Algorithm MD5).Hash.ToLowerInvariant() -ne $expectedMD5) {
        throw 'Existing source differs from the pinned original. Inspect it before replacing it.'
    }
    Write-Host 'Existing source verified; no data download needed.'
} else {
    $downloadFile = "$sourceFile.download"
    & curl.exe -fL --retry 2 --max-time 900 'https://ndownloader.figshare.com/files/24072995' -o $downloadFile
    if ($LASTEXITCODE -ne 0) { throw 'Download failed; the final source file was not created.' }
    if ((Get-Item -LiteralPath $downloadFile).Length -ne $expectedSize -or (Get-FileHash -LiteralPath $downloadFile -Algorithm MD5).Hash.ToLowerInvariant() -ne $expectedMD5) { throw 'Downloaded source checksum mismatch.' }
    Move-Item -LiteralPath $downloadFile -Destination $sourceFile
}
if (-not (Test-Path -LiteralPath $metadataFile)) {
    & curl.exe -fL --max-time 60 'https://api.figshare.com/v2/articles/12715853' -o $metadataFile
    if ($LASTEXITCODE -ne 0) { throw 'Source metadata download failed.' }
}
Write-Host 'Source ready. Run: python pipeline.py all'
