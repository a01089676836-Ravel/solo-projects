import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentMessages, callAgentApi, runObservationsWithAgent } from '../src/agent-api.mjs';
import { buildRecoveryTrace, buildPipelineTrace, runReliableScenario } from '../src/reliable-pipeline.mjs';
import { generateScenario, runScenario, trainDemoModel } from '../src/agent-harness.mjs';
import { getAgentSkillManifest, selectAgentSkills, validateAgentSkillFiles } from '../src/skill-registry.mjs';

test('runtime skills are present, unique, and selected by safety state', () => {
  const manifest = getAgentSkillManifest();
  assert.deepEqual(manifest.map(skill => skill.id), [
    'verification-first', 'grounding-gate', 'safe-escalation', 'recovery-verification'
  ]);
  assert.equal(new Set(manifest.map(skill => skill.id)).size, manifest.length);
  assert.equal(validateAgentSkillFiles().length, 4);
  assert.deepEqual(selectAgentSkills(runScenario('normal')).map(skill => skill.id), [
    'verification-first', 'grounding-gate'
  ]);
  assert.deepEqual(selectAgentSkills(runScenario('temperature_rise')).map(skill => skill.id), [
    'verification-first', 'grounding-gate', 'safe-escalation', 'recovery-verification'
  ]);
});

test('pipeline keeps safety decision local and records operator gate', async () => {
  const result = await runReliableScenario('person_emergency', {
    fetchImpl: async () => { throw new Error('offline'); },
    baseUrl: 'http://127.0.0.1:8000'
  });
  assert.equal(result.event.state, 'EMERGENCY');
  assert.deepEqual(result.event.actuator, { led: 'RED', buzzer: 'CONTINUOUS', servo: 'STOP' });
  assert.equal(result.agent.mode, 'fallback');
  assert.equal(result.pipeline.decision.agentHasNoActuatorAuthority, true);
  assert.equal(result.pipeline.stages.find(stage => stage.id === 'operator_gate').status, 'required');
  assert.equal(result.pipeline.stages.find(stage => stage.id === 'recovery_verification').status, 'pending');
});

test('remote model cannot select an SOP outside local retrieval result', async () => {
  const event = runScenario('temperature_rise');
  const result = await callAgentApi(event, {
    baseUrl: 'http://127.0.0.1:8000',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      status: 'insufficient_evidence', evidenceIds: ['e0'], sopIds: ['sop-person-001'],
      observations: [], hypotheses: [], recommendedChecks: [], limitations: [], requiresHumanConfirmation: true
    }) } }] }) })
  });
  assert.equal(result.mode, 'fallback');
});

test('Astra-compatible request omits temperature while retaining structured output', async () => {
  const event = runScenario('temperature_rise');
  let request;
  const result = await callAgentApi(event, {
    baseUrl: 'http://127.0.0.1:8000', model: 'gpt-6-astra',
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        status: 'insufficient_evidence', evidenceIds: ['e0'], sopIds: ['sop-temperature-001'],
        observations: [], hypotheses: [], recommendedChecks: [], limitations: [], requiresHumanConfirmation: true
      }) } }] }) };
    }
  });
  assert.equal(result.mode, 'remote_api');
  assert.equal(Object.hasOwn(request, 'temperature'), false);
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(result.plan.hallucinationGate, 'grounded_structured_selection');
});

test('live observation path requires an explicit model and keeps fallback available', async () => {
  const observations = generateScenario('temperature_rise');
  await assert.rejects(() => runObservationsWithAgent(observations, {
    fetchImpl: async () => { throw new Error('offline'); }
  }), /modelForDetection is required/);
  const result = await runObservationsWithAgent(observations, {
    modelForDetection: trainDemoModel(),
    fetchImpl: async () => { throw new Error('offline'); }
  });
  assert.equal(result.event.state, 'ANOMALY');
  assert.equal(result.agent.mode, 'fallback');
});

test('recovery trace never authorizes automatic resume', () => {
  const recovery = buildRecoveryTrace(generateScenario('normal'), trainDemoModel());
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.automaticResume, false);
  assert.equal(recovery.status, 'verified_pending_operator_approval');
});

test('pipeline trace can be rebuilt from an existing event and agent result', async () => {
  const result = await runReliableScenario('temperature_rise', {
    fetchImpl: async () => { throw new Error('offline'); },
    baseUrl: 'http://127.0.0.1:8000'
  });
  const trace = buildPipelineTrace(result);
  assert.equal(trace.eventId, result.event.eventId);
  assert.equal(trace.pipelineVersion, 'reliable-edge-agent-v1');
  assert.ok(trace.stages.some(stage => stage.id === 'evidence_grounding'));
  assert.ok(buildAgentMessages(result.event)[0].content.includes('verification-first'));
});
