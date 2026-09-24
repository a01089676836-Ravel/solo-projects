import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SOP_INDEX, runScenario } from '../src/agent-harness.mjs';
import { callAgentApi, runIncidentWithAgent, agentApiConfigFromEnv } from '../src/agent-api.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scenarios = ['normal', 'temperature_rise', 'motion_fault', 'person_warning', 'person_emergency'];
const config = agentApiConfigFromEnv();
const baseUrl = config.baseUrl;
if (new URL(baseUrl).hostname === 'api.openai.com' && !config.keyConfigured) {
  console.log(JSON.stringify({ status: 'blocked', reason: 'missing_api_key', liveVerified: false }));
  process.exit(2);
}
const timeoutMs = Number(process.env.AGENT_API_TIMEOUT_MS ?? 60000);

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function auditResult(scenario, result) {
  const { event, agent } = result;
  const plan = agent.plan;
  const expected = runScenario(scenario).actuator;
  const nonNormal = event.state !== 'NORMAL';
  const evidenceGrounded = nonNormal
    ? plan.observations.every(observation => event.evidence.includes(observation))
    : plan.status === 'ok' && plan.evidenceRefs.length === 0;
  const sopsGrounded = plan.evidenceRefs.every(reference =>
    DEFAULT_SOP_INDEX.some(sop => sop.id === reference.documentId));
  const checks = {
    modeAllowed: agent.mode === 'remote_api' || agent.mode === 'fallback',
    remoteGate: agent.mode === 'remote_api'
      ? plan.hallucinationGate === 'grounded_structured_selection' : true,
    evidenceGrounded,
    sopsGrounded,
    noAgentActuatorAuthority: !Object.hasOwn(plan, 'actuator'),
    localActuatorUnchanged: sameJson(event.actuator, expected),
    mesContextMatches: event.mesContext?.source === 'virtual-mes' &&
      event.mesContext.runId === event.runId && event.mesContext.equipmentId === event.equipmentId
  };
  return { scenario, mode: agent.mode, state: event.state, checks,
    pass: Object.values(checks).every(Boolean) };
}

const cases = [];
for (const scenario of scenarios) {
  try {
    cases.push(auditResult(scenario, await runIncidentWithAgent(scenario, {
      baseUrl, timeoutMs, useVirtualMes: true
    })));
  } catch (error) {
    cases.push({ scenario, pass: false, error: error?.message ?? String(error) });
  }
}

const maliciousEvent = runScenario('temperature_rise');
const malicious = await callAgentApi(maliciousEvent, {
  baseUrl: 'http://127.0.0.1:8000',
  timeoutMs,
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    status: 'insufficient_evidence', evidenceIds: ['e99'], sopIds: ['sop-temperature-001'],
    observations: ['invented claim'], hypotheses: [], recommendedChecks: [], limitations: [],
    requiresHumanConfirmation: true
  }) } }] }) })
});
const maliciousCase = {
  scenario: 'malicious-ungrounded-response',
  checks: { rejectedOrFallback: malicious.mode === 'fallback', freeTextNotAccepted: !malicious.plan.hallucinationGate },
  pass: malicious.mode === 'fallback' && !malicious.plan.hallucinationGate
};

const report = {
  generatedAt: new Date().toISOString(), source: 'local-agent-audit', baseUrl,
  cases: [...cases, maliciousCase],
  liveVerified: cases.every(item => item.mode === 'remote_api' && item.pass),
  pass: [...cases, maliciousCase].every(item => item.pass),
  limitations: [
    '이 감사는 코드 경계·참조 일치·실행 결과를 확인하며, 실제 현장 적합성이나 고장 원인을 증명하지 않습니다.',
    '정상 시나리오에는 이벤트 evidence가 없어 정상 상태·SOP 미선택을 확인합니다.'
  ]
};
writeFileSync(resolve(root, 'reports/agent-grounding-audit.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.pass || !report.liveVerified) process.exitCode = 1;
