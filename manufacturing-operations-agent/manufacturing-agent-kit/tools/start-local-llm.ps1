param(
  [int]$Port = 8000,
  [int]$Context = 2048,
  [int]$Predict = 128
)

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'tools/local-llm/bin/llama-server.exe'
$model = Join-Path $root 'tools/local-llm/models/qwen2.5-0.5b-instruct-q4_k_m.gguf'
$logDir = Join-Path $root 'tools/local-llm'
$out = Join-Path $logDir 'server.out.log'
$err = Join-Path $logDir 'server.err.log'

if (!(Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath $model)) {
  throw 'Local llama.cpp runtime or Qwen GGUF model is missing.'
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Write-Output "Local LLM server is already listening on 127.0.0.1:$Port (PID $($listener.OwningProcess))."
  exit 0
}

$process = Start-Process -FilePath $exe -ArgumentList @(
  '-m', $model, '--host', '127.0.0.1', '--port', $Port,
  '-c', $Context, '-n', $Predict
) -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru

Write-Output "Started Qwen2.5-0.5B-Instruct llama.cpp server (PID $($process.Id)) at http://127.0.0.1:$Port."
