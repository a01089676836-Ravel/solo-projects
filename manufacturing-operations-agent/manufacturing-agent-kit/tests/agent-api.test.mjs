import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario } from '../src/agent-harness.mjs';
import { createVirtualMesContext, attachMesContext } from '../src/mes-lite.mjs';
import { agentApiConfigFromEnv, buildAgentMessages, callAgentApi, parseAgentJson, runIncidentWithAgent } from '../src/agent-api.mjs';

test('API configuration is explicit and does not require a secret for local endpoints', () => {
  const config = agentApiConfigFromEnv({ AGENT_API_BASE_URL: 'http://pc:8000', AGENT_API_MODEL: 'local-model', AGENT_API_TIMEOUT_MS: '3000' });
  assert.deepEqual(config, { baseUrl: 'http://pc:8000', model: 'local-model', timeoutMs: 3000, keyConfigured: false });
});

test('remote Agent JSON is strictly validated', () => {
  const plan = parseAgentJson(JSON.stringify({ status: 'insufficient_evidence', evidenceIds: ['e0'], sopIds: ['sop-temperature-001'], observations: ['o'], hypotheses: ['h'], recommendedChecks: ['c'], limitations: ['l'], requiresHumanConfirmation: true }));
  assert.equal(plan.status, 'insufficient_evidence');
  assert.throws(() => parseAgentJson('{"status":"ok"}'), /Invalid confirmation flag/);
  assert.throws(() => parseAgentJson('not json'), /valid JSON/);
});

test('valid remote response becomes an Agent plan without actuator authority', async () => {
  const event = runScenario('temperature_rise');
  const result = await callAgentApi(event, {
    baseUrl: 'http://pc:8000', model: 'test-model', apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      assert.equal(url, 'http://pc:8000/v1/chat/completions');
      assert.equal(request.headers.Authorization, 'Bearer test-key');
      const sent = JSON.parse(request.body);
      assert.equal(sent.response_format.type, 'json_schema');
      assert.deepEqual(sent.response_format.json_schema.schema.properties.status.enum, ['insufficient_evidence']);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        status: 'insufficient_evidence', evidenceIds: ['e0', 'e1'], sopIds: ['sop-temperature-001'],
        observations: ['ignored by grounding gate'], hypotheses: ['ignored by grounding gate'],
        recommendedChecks: ['ignored by grounding gate'], limitations: ['not a confirmed failure'], requiresHumanConfirmation: true
      }) } }] }) };
    }
  });
  assert.equal(result.mode, 'remote_api');
  assert.equal(result.plan.toolTrace[1].tool, 'grounding_gate');
  assert.equal(result.plan.hallucinationGate, 'grounded_structured_selection');
  assert.match(result.plan.observations[0], /온도/);
  assert.match(result.plan.recommendedChecks.join(' '), /통풍/);
  assert.equal(result.plan.actuator, undefined);
});

test('API timeout or failure falls back to local SOP Agent', async () => {
  const event = runScenario('temperature_rise');
  const result = await callAgentApi(event, { baseUrl: 'http://pc:8000', timeoutMs: 100,
    fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(result.mode, 'fallback');
  assert.equal(result.plan.toolTrace[0].tool, 'search_sop');
});

test('ungrounded remote claims are rejected and cannot reach the user', async () => {
  const event = runScenario('temperature_rise');
  const result = await callAgentApi(event, {
    baseUrl: 'http://pc:8000', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      status: 'insufficient_evidence', evidenceIds: ['e99'], sopIds: ['sop-temperature-001'], observations: [], hypotheses: [], recommendedChecks: [], limitations: [], requiresHumanConfirmation: true
    }) } }] }) })
  });
  assert.equal(result.mode, 'fallback');
  assert.equal(result.reason, 'api_unavailable');
  assert.equal(result.plan.hallucinationGate, undefined);
});

test('end-to-end incident runner preserves local safety output and swaps only the Agent plan', async () => {
  const result = await runIncidentWithAgent('person_emergency', {
    fetchImpl: async () => { throw new Error('offline'); }
  });
  assert.equal(result.event.state, 'EMERGENCY');
  assert.equal(result.event.actuator.servo, 'STOP');
  assert.equal(result.agent.mode, 'fallback');
  assert.equal(result.agent.plan.evidenceRefs[0].documentId, 'sop-person-001');
});

test('optional virtual MES context reaches the Agent as facts without changing safety output', async () => {
  const result = await runIncidentWithAgent('temperature_rise', {
    useVirtualMes: true, fetchImpl: async () => { throw new Error('offline'); }
  });
  assert.equal(result.event.mesContext.source, 'virtual-mes');
  assert.equal(result.event.mesContext.runId, result.event.runId);
  assert.equal(result.event.mesContext.operationMode, 'AUTO');
  assert.equal(result.event.actuator.servo, 'STOP');
  assert.equal(result.agent.mode, 'fallback');
});

test('Agent receives MES context as facts without receiving control authority', () => {
  const event = runScenario('temperature_rise');
  const mesEvent = attachMesContext(event, createVirtualMesContext({ runId: event.runId }));
  const messages = buildAgentMessages(mesEvent);
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.facts.mesContext.operationMode, 'AUTO');
  assert.equal(payload.facts.mesContext.processModeId, 'DEMO-AUTO');
  assert.equal(Object.hasOwn(payload.facts, 'actuator'), true);
  assert.match(messages[0].content, /Do not invent or modify work orders/);
});
