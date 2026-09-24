import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentMessages, callAgentApi } from '../src/agent-api.mjs';
import { buildRecoveryTrace, runReliableScenario } from '../src/reliable-pipeline.mjs';
import { DEFAULT_SOP_INDEX, generateScenario, runScenario, trainDemoModel } from '../src/agent-harness.mjs';
import { getAgentSkillManifest, validateAgentSkillFiles } from '../src/skill-registry.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scenarios = ['normal', 'temperature_rise', 'motion_fault', 'person_warning', 'person_emergency'];

const offlineFetch = async () => { throw new Error('harness_offline'); };

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function scenarioCase(scenario) {
  return runReliableScenario(scenario, {
    useVirtualMes: true,
    baseUrl: 'http://127.0.0.1:8000',
    timeoutMs: 100,
    fetchImpl: offlineFetch
  }).then(result => {
    const expected = runScenario(scenario).actuator;
    const { event, agent, pipeline } = result;
    const nonNormal = event.state !== 'NORMAL';
    const stages = new Set(pipeline.stages.map(item => item.id));
    const checks = {
      fallbackIsExplicit: agent.mode === 'fallback' && pipeline.stages.find(item => item.id === 'evidence_grounding')?.status === 'fallback',
      localSafetyOwnsActuator: pipeline.decision.agentHasNoActuatorAuthority && sameJson(event.actuator, expected),
      evidenceReferencesAreLocal: pipeline.stages.find(item => item.id === 'evidence_grounding')?.evidenceGrounded === true,
      nonNormalRequiresHuman: !nonNormal || pipeline.stages.find(item => item.id === 'operator_gate')?.status === 'required',
      allStagesPresent: [...['observation', 'local_safety_decision', 'evidence_grounding', 'operator_gate', 'recovery_verification']]
        .every(stageId => stages.has(stageId)),
      virtualMesIsScoped: event.mesContext?.source === 'virtual-mes' && event.mesContext.runId === event.runId
    };
    return { scenario, state: event.state, mode: agent.mode, checks, pass: Object.values(checks).every(Boolean) };
  });
}

async function maliciousResponseCase() {
  const event = runScenario('temperature_rise');
  const result = await callAgentApi(event, {
    baseUrl: 'http://127.0.0.1:8000',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      status: 'insufficient_evidence', evidenceIds: ['e0'],
      sopIds: ['sop-person-001'], observations: ['invented'], hypotheses: [],
      recommendedChecks: [], limitations: [], requiresHumanConfirmation: true
    }) } }] }) })
  });
  const checks = {
    rejectedOrFallback: result.mode === 'fallback',
    noRemoteGate: !result.plan.hallucinationGate,
    noUnapprovedSop: result.plan.evidenceRefs.every(reference => reference.documentId === 'sop-temperature-001')
  };
  return { case: 'unapproved-sop-selection', checks, pass: Object.values(checks).every(Boolean) };
}

async function validRemoteCase() {
  const event = runScenario('temperature_rise');
  let request;
  const result = await callAgentApi(event, {
    baseUrl: 'http://127.0.0.1:8000', model: 'gpt-6-astra',
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        status: 'insufficient_evidence', evidenceIds: ['e0'], sopIds: ['sop-temperature-001'],
        observations: ['ignored'], hypotheses: ['ignored'], recommendedChecks: ['ignored'],
        limitations: [], requiresHumanConfirmation: true
      }) } }] }) };
    }
  });
  const checks = {
    remoteAccepted: result.mode === 'remote_api',
    astraTemperatureOmitted: !Object.hasOwn(request, 'temperature'),
    groundingGateApplied: result.plan.hallucinationGate === 'grounded_structured_selection',
    actuatorAbsent: !Object.hasOwn(result.plan, 'actuator')
  };
  return { case: 'astra-compatible-structured-selection', checks, pass: Object.values(checks).every(Boolean) };
}

async function main() {
  const skillFiles = validateAgentSkillFiles();
  const skillManifest = getAgentSkillManifest();
  const messageSkills = buildAgentMessages(runScenario('temperature_rise'))[0].content;
  const cases = await Promise.all(scenarios.map(scenarioCase));
  cases.push(await maliciousResponseCase());
  cases.push(await validRemoteCase());
  const recovery = buildRecoveryTrace(generateScenario('normal'), trainDemoModel());
  const recoveryCase = {
    case: 'recovery-requires-human-approval',
    checks: {
      verifiedNormalFollowup: recovery.recovered === true,
      automaticResumeBlocked: recovery.automaticResume === false,
      approvalStatusExplicit: recovery.status === 'verified_pending_operator_approval'
    },
    pass: recovery.recovered === true && recovery.automaticResume === false &&
      recovery.status === 'verified_pending_operator_approval'
  };
  cases.push(recoveryCase);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'local-reliability-harness',
    skills: { count: skillManifest.length, manifest: skillManifest, files: skillFiles,
      promptInjectedIntoRuntime: messageSkills.includes('verification-first') },
    cases,
    pass: cases.every(item => item.pass),
    limitations: [
      '모든 실행은 합성 시나리오·mock remote 응답·로컬 fallback을 사용했습니다.',
      '실제 Jetson 센서·현장 SOP·작업자 판단 시간은 검증하지 않았습니다.',
      'Astra 모델 자체의 품질·지연·비용은 API 호출 없이 계약 호환성만 확인했습니다.'
    ]
  };
  writeFileSync(resolve(root, 'reports/reliability-harness.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}

await main();
