import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReliableScenario } from '../src/reliable-pipeline.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scenario = process.argv[2] ?? 'temperature_rise';
const result = await runReliableScenario(scenario, { offline: true, useVirtualMes: true });
const report = {
  checkedAt: new Date().toISOString(),
  status: result.agent.mode === 'fallback' && result.agent.reason === 'offline_mode' ? 'passed' : 'failed',
  scenario,
  mode: result.agent.mode,
  reason: result.agent.reason ?? null,
  state: result.event.state,
  localActuator: result.event.actuator,
  evidenceRefs: result.agent.plan.evidenceRefs,
  requiresHumanConfirmation: result.agent.plan.requiresHumanConfirmation,
  externalApiCalled: false,
  scope: 'offline deterministic fallback; no cloud API and no local LLM request'
};
writeFileSync(resolve(root, 'reports/offline-run.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'passed' ? 0 : 1;
