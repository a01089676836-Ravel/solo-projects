import {
  runIncidentWithAgent,
  runObservationsWithAgent
} from './agent-api.mjs';
import { DEFAULT_SOP_INDEX, verifyRecovery } from './agent-harness.mjs';
import { selectAgentSkills } from './skill-registry.mjs';

export const PIPELINE_VERSION = 'reliable-edge-agent-v1';
export const PIPELINE_STAGES = Object.freeze([
  'observation',
  'local_safety_decision',
  'evidence_grounding',
  'operator_gate',
  'recovery_verification'
]);

function stage(id, status, details = {}) {
  return { id, status, ...details };
}

function eventEvidenceIsGrounded(event, plan) {
  if (event.state === 'NORMAL') return plan.status === 'ok' && plan.evidenceRefs.length === 0;
  return plan.observations.every(item => event.evidence.includes(item));
}

function sopReferencesAreApproved(plan) {
  return plan.evidenceRefs.every(reference => DEFAULT_SOP_INDEX.some(sop => sop.id === reference.documentId));
}

export function buildPipelineTrace({ event, agent }) {
  if (!event || !agent?.plan) throw new Error('event and agent plan are required');
  const plan = agent.plan;
  const nonNormal = event.state !== 'NORMAL';
  const evidenceGrounded = eventEvidenceIsGrounded(event, plan);
  const sopGrounded = sopReferencesAreApproved(plan);
  const agentHasNoActuatorAuthority = !Object.hasOwn(plan, 'actuator');
  const skills = selectAgentSkills(event).map(skill => ({ id: skill.id, version: skill.version }));
  const agentStageStatus = agent.mode === 'remote_api'
    ? (plan.hallucinationGate === 'grounded_structured_selection' && evidenceGrounded && sopGrounded
      ? 'passed' : 'failed')
    : 'fallback';

  return {
    schemaVersion: 1,
    pipelineVersion: PIPELINE_VERSION,
    eventId: event.eventId,
    runId: event.runId,
    equipmentId: event.equipmentId,
    observedAt: event.observedAt,
    state: event.state,
    severity: event.severity,
    activeSkills: skills,
    stages: [
      stage('observation', 'passed', {
        source: event.scenarioId === 'unlabelled' ? 'observation-window' : 'scenario-fixture',
        windowStart: event.windowStart,
        windowEnd: event.windowEnd,
        evidenceCount: event.evidence.length
      }),
      stage('local_safety_decision', 'passed', {
        authority: 'deterministic-local-safety-boundary',
        state: event.state,
        actuator: event.actuator,
        llmCanOverride: false
      }),
      stage('evidence_grounding', agentStageStatus, {
        mode: agent.mode,
        evidenceGrounded,
        sopGrounded,
        hallucinationGate: plan.hallucinationGate ?? 'local-deterministic-fallback',
        evidenceRefs: plan.evidenceRefs
      }),
      stage('operator_gate', nonNormal ? 'required' : 'not_required', {
        requiresHumanConfirmation: Boolean(plan.requiresHumanConfirmation),
        automaticResume: false,
        nextAction: nonNormal ? 'request_operator_confirmation' : 'continue_monitoring'
      }),
      stage('recovery_verification', 'pending', {
        reason: 'followup_window_not_supplied',
        nextAction: nonNormal ? 'collect_followup_window' : 'not_applicable'
      })
    ],
    decision: {
      localState: event.state,
      localActuator: event.actuator,
      agentStatus: plan.status,
      agentMode: agent.mode,
      agentHasNoActuatorAuthority
    },
    limitations: [
      ...(event.limitations ?? []),
      ...(agent.mode === 'fallback' ? [`원격 Agent를 사용하지 않고 결정론적 fallback을 사용했습니다: ${agent.reason ?? 'unknown'}`] : []),
      '이 초기 파이프라인은 실제 GPIO/I2C 제어를 연결하지 않습니다.',
      '하네스 통과는 현장 일반화·고장 원인 확정·작업자 사용성 검증이 아닙니다.'
    ]
  };
}

export async function runReliableScenario(scenario = 'temperature_rise', options = {}) {
  const result = await runIncidentWithAgent(scenario, options);
  return { ...result, pipeline: buildPipelineTrace(result) };
}

export async function runReliableObservations(observations, options = {}) {
  const result = await runObservationsWithAgent(observations, options);
  return { ...result, pipeline: buildPipelineTrace(result) };
}

export function buildRecoveryTrace(followupWindow, model, options = {}) {
  const recovery = verifyRecovery(followupWindow, model, options);
  return {
    schemaVersion: 1,
    stage: 'recovery_verification',
    status: recovery.recovered ? 'verified_pending_operator_approval' : 'escalation_required',
    recovered: recovery.recovered,
    state: recovery.state,
    observedAt: recovery.observedAt,
    evidence: recovery.evidence,
    nextAction: recovery.nextAction,
    automaticResume: false,
    limitations: [
      '회복 판정은 후속 관측 window의 상태 판정이며, 재가동 승인 자체가 아닙니다.',
      '후속 관측이 실제 현장 상태를 대표하는지는 별도 검증이 필요합니다.'
    ]
  };
}
