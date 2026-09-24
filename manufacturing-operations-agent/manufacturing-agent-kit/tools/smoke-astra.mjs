import { writeFileSync } from 'node:fs';
import { runIncidentWithAgent, agentApiConfigFromEnv } from '../src/agent-api.mjs';

const config = agentApiConfigFromEnv();
let report;
if (config.model !== 'gpt-6-astra' || new URL(config.baseUrl).origin !== 'https://api.openai.com') {
  report = { status: 'blocked', reason: 'astra_official_endpoint_required', liveVerified: false };
} else if (!config.keyConfigured) {
  report = { status: 'blocked', reason: 'missing_api_key', liveVerified: false };
} else {
  const start = performance.now();
  const result = await runIncidentWithAgent('temperature_rise');
  const pass = result.agent.mode === 'remote_api' && result.agent.model === 'gpt-6-astra' &&
    result.agent.plan.hallucinationGate === 'grounded_structured_selection' &&
    result.event.actuator.servo === 'STOP';
  report = { status: pass ? 'passed' : 'failed', liveVerified: pass,
    apiError: result.agent.apiError ?? null,
    reason: result.agent.reason ?? null, model: result.agent.model,
    mode: result.agent.mode, latencyMs: Math.round(performance.now() - start), usage: result.agent.usage ?? null };
}
report.checkedAt = new Date().toISOString();
report.scope = 'one synthetic incident; not field validation';
writeFileSync(new URL('../reports/astra-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'passed' ? 0 : report.status === 'blocked' ? 2 : 1;
