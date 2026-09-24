param(
  [ValidateSet('normal', 'temperature_rise', 'motion_fault', 'person_warning', 'person_emergency')]
  [string]$Scenario = 'temperature_rise',
  [switch]$VirtualMes
)

$env:AGENT_API_BASE_URL = 'http://127.0.0.1:8000'
$env:AGENT_API_MODEL = 'Qwen2.5-0.5B-Instruct'
$env:AGENT_API_TIMEOUT_MS = '60000'
$arguments = @($Scenario)
if ($VirtualMes) { $arguments += '--virtual-mes' }
node (Join-Path $PSScriptRoot '..\src\agent-api.mjs') @arguments
