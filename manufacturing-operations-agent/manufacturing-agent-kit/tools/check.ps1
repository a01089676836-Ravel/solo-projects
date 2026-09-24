param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$required = @(
    'AGENTS.md', 'STATE.md',
    'skill/manufacturing-anomaly-agent/SKILL.md',
    'skill/manufacturing-anomaly-agent/agents/openai.yaml',
    'skill/manufacturing-anomaly-agent/references/project.md',
    'skill/manufacturing-anomaly-agent/references/delivery.md',
    'evals/scenarios.json',
    'agent-skills/manifest.json',
    'agent-skills/verification-first/SKILL.md',
    'agent-skills/grounding-gate/SKILL.md',
    'agent-skills/safe-escalation/SKILL.md',
    'agent-skills/recovery-verification/SKILL.md',
    'src/skill-registry.mjs',
    'src/reliable-pipeline.mjs',
    'tools/reliability-harness.mjs',
    'tests/reliable-pipeline.test.mjs',
    'docs/reliable-agent-system.md',
    'config/agent-runtime.json', 'src/runtime-config.mjs',
    'skill/runtime-maintenance/SKILL.md', 'tools/check-maintenance.mjs',
    'tools/offline-run.mjs', 'tools/local-agent-check.mjs', 'tools/reliability-comparison.mjs',
    'tests/astra-runtime.test.mjs', 'tests/maintenance.test.mjs'
)
foreach ($relative in $required) {
    $file = Join-Path $Root $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing file: $relative" }
    if ((Get-Item -LiteralPath $file).Length -eq 0) { throw "Empty file: $relative" }
}
$parsed = Get-Content -LiteralPath (Join-Path $Root 'evals/scenarios.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$cases = @($parsed)
if ($cases.Count -eq 0) { throw 'No evaluation scenarios' }
$ids = @{}
foreach ($case in $cases) {
    foreach ($field in @('id','input','expected','stage')) {
        if ($case.$field -isnot [string] -or [string]::IsNullOrWhiteSpace($case.$field)) { throw "Missing or invalid scenario field: $field" }
    }
    if ($ids.ContainsKey($case.id)) { throw "Duplicate scenario: $($case.id)" }
    $ids[$case.id] = $true
}
Write-Output "PASS: preparation files and $($cases.Count) scenario definitions."
Push-Location $Root
try {
    & node --test tests/baseline.test.mjs tests/events.test.mjs tests/feedback.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Project tests failed' }
    & node --test tests/agent-harness.test.mjs tests/agent-api.test.mjs tests/reliable-pipeline.test.mjs tests/astra-runtime.test.mjs tests/maintenance.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Agent pipeline tests failed' }
} finally { Pop-Location }
Write-Output 'NOT RUN by this check: real Jetson I/O, UI browser inspection, and human usability evaluation. Baseline metrics: reports/baseline.json.'
