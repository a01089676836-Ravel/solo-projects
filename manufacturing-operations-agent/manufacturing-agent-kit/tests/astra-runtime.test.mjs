import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { agentApiConfigFromEnv, buildAgentMessages, callAgentApi } from '../src/agent-api.mjs';
import { runScenario } from '../src/agent-harness.mjs';
import { runtimeConfig, chatEndpoint } from '../src/runtime-config.mjs';

const event = runScenario('temperature_rise');
const valid = { status: 'insufficient_evidence', evidenceIds: ['e0'],
  sopIds: ['sop-temperature-001'], requiresHumanConfirmation: true };
const bodyFor = (value = valid, extra = {}) => ({ choices: [{ finish_reason: 'stop',
  message: { content: JSON.stringify(value) }, ...extra }] });
const reply = body => async () => ({ ok: true, status: 200, json: async () => body });

test('default runtime is official Astra, config output never includes the key', () => {
  const config = agentApiConfigFromEnv({ OPENAI_API_KEY: 'not-a-real-key' });
  assert.equal(config.model, 'gpt-6-astra');
  assert.equal(config.baseUrl, 'https://api.openai.com/v1');
  assert.equal(config.keyConfigured, true);
  assert.ok(!JSON.stringify(config).includes('not-a-real-key'));
});

test('OpenAI key cannot be inherited by a local or alternate endpoint', () => {
  const config = runtimeConfig({ OPENAI_API_KEY: 'private', AGENT_API_BASE_URL: 'http://localhost:8000' });
  assert.equal(config.apiKey, undefined);
});

test('endpoint normalization preserves one v1 and disallows URL credentials and insecure OpenAI', () => {
  for (const base of ['https://api.openai.com', 'https://api.openai.com/v1/',
    'https://api.openai.com/v1/chat/completions'])
    assert.equal(chatEndpoint(base), 'https://api.openai.com/v1/chat/completions');
  for (const base of ['http://api.openai.com', 'https://user:secret@example.com', 'https://example.com?key=secret'])
    assert.throws(() => chatEndpoint(base));
});

test('missing API key uses explicit fallback without any network call', async () => {
  let calls = 0;
  const result = await callAgentApi(event, { env: {}, fetchImpl: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(result.mode, 'fallback');
  assert.equal(result.reason, 'missing_api_key');
});

test('offline mode never calls a configured provider and keeps local safety plan', async () => {
  let calls = 0;
  const result = await callAgentApi(event, { offline: true, env: { OPENAI_API_KEY: 'fixture-only' },
    fetchImpl: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(result.mode, 'fallback');
  assert.equal(result.reason, 'offline_mode');
  assert.equal(result.plan.requiresHumanConfirmation, true);
  assert.equal(result.plan.evidenceRefs[0].documentId, 'sop-temperature-001');
});

for (const [code, type] of [
  ['insufficient_quota', 'insufficient_quota'],
  ['credit_balance_exhausted', 'insufficient_quota'],
  ['rate_limit_exceeded', 'rate_limit_error'],
  ['fixture-private-secret', 'fixture-private-secret']
]) test(`HTTP diagnostics are allowlisted without echoing secrets: ${code}`, async () => {
  let calls = 0;
  const result = await callAgentApi(event, { env: { OPENAI_API_KEY: 'fixture-private-secret' },
    fetchImpl: async () => {
      calls++;
      return { ok: false, status: 429, json: async () => ({ error: {
        code, type, message: 'fixture-private-secret', param: 'fixture-private-secret'
      } }) };
    } });
  assert.equal(calls, 1);
  assert.equal(result.mode, 'fallback');
  assert.equal(result.reason, 'api_http_429');
  assert.deepEqual(result.apiError, code === 'fixture-private-secret'
    ? { code: null, type: null } : { code, type });
  assert.ok(!JSON.stringify(result).includes('fixture-private-secret'));
});

test('non-JSON HTTP errors preserve status without leaking the response', async () => {
  const result = await callAgentApi(event, { env: { OPENAI_API_KEY: 'fixture-only' },
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new Error('private-html'); } }) });
  assert.equal(result.reason, 'api_http_502');
  assert.deepEqual(result.apiError, { code: null, type: null });
  assert.ok(!JSON.stringify(result).includes('private-html'));
});

test('official Astra request is bounded and carries actual evidence/procedure mappings', async () => {
  let sent;
  const result = await callAgentApi(event, { env: { OPENAI_API_KEY: 'fixture-only' },
    fetchImpl: async (url, request) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(request.headers.Authorization, 'Bearer fixture-only');
      assert.equal(request.redirect, 'error');
      sent = JSON.parse(request.body);
      return { ok: true, json: async () => ({ ...bodyFor(), usage: { prompt_tokens: 50,
        completion_tokens: 20, total_tokens: 70, untrusted: 'do not log' } }) };
    } });
  assert.equal(result.mode, 'remote_api');
  assert.equal(sent.model, 'gpt-6-astra');
  assert.equal(sent.reasoning_effort, 'low');
  assert.equal(sent.max_completion_tokens, 2048);
  assert.equal(sent.store, false);
  assert.equal(sent.temperature, undefined);
  assert.equal(sent.response_format.json_schema.strict, true);
  const facts = JSON.parse(sent.messages[1].content).facts;
  assert.deepEqual(facts.evidenceCatalog[0], { id: 'e0', text: event.evidence[0] });
  assert.equal(facts.sopCatalog[0].id, 'sop-temperature-001');
  assert.ok(facts.sopCatalog[0].steps.length > 0);
  assert.match(facts.sopCatalog[0].sourceType, /demo/);
  assert.deepEqual(result.usage, { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 });
});

test('empty normal selection has typed array schema and accepts empty IDs', async () => {
  const normal = runScenario('normal');
  const result = await callAgentApi(normal, { env: {}, baseUrl: 'http://fixture:8000',
    fetchImpl: async (_url, request) => {
      const schema = JSON.parse(request.body).response_format.json_schema.schema;
      assert.equal(schema.properties.sopIds.items.type, 'string');
      assert.equal(schema.properties.sopIds.maxItems, 0);
      return { ok: true, json: async () => bodyFor({ status: 'ok', evidenceIds: [], sopIds: [], requiresHumanConfirmation: false }) };
    } });
  assert.equal(result.mode, 'remote_api');
});

for (const [name, payload, expected] of [
  ['refusal', bodyFor(valid, { message: { refusal: 'declined' } }), 'api_refusal'],
  ['token limit', bodyFor(valid, { finish_reason: 'length' }), 'api_incomplete'],
  ['invented evidence', bodyFor({ ...valid, evidenceIds: ['e99'] }), 'api_unavailable'],
  ['duplicate SOP', bodyFor({ ...valid, sopIds: ['sop-temperature-001', 'sop-temperature-001'] }), 'api_unavailable'],
  ['confirmation bypass', bodyFor({ ...valid, requiresHumanConfirmation: false }), 'api_unavailable']
]) test(`${name} does not become a live success`, async () => {
  const result = await callAgentApi(event, { env: {}, baseUrl: 'http://fixture:8000', fetchImpl: reply(payload) });
  assert.equal(result.mode, 'fallback');
  assert.equal(result.reason, expected);
  assert.equal(result.plan.actuator, undefined);
});

test('no local procedure evidence abstains before sending an API request', async () => {
  let calls = 0;
  const result = await callAgentApi({ ...event, evidence: ['unmapped condition'] }, {
    env: {}, baseUrl: 'http://fixture:8000', fetchImpl: async () => { calls++; } });
  assert.equal(result.reason, 'no_sop_evidence');
  assert.equal(calls, 0);
});

test('local Qwen override still uses its original sampling request', async () => {
  const result = await callAgentApi(event, { env: {}, baseUrl: 'http://fixture:8000', model: 'Qwen2.5-0.5B-Instruct',
    fetchImpl: async (_url, options) => {
      const sent = JSON.parse(options.body);
      assert.equal(sent.temperature, 0);
      assert.equal(sent.reasoning_effort, undefined);
      return { ok: true, json: async () => bodyFor() };
    } });
  assert.equal(result.mode, 'remote_api');
});

test('real HTTP transport succeeds locally and aborts a stalled response', async t => {
  let stall = false;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (!stall) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(bodyFor())); }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const options = { env: {}, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, timeoutMs: 1000 };
  assert.equal((await callAgentApi(event, options)).mode, 'remote_api');
  stall = true;
  assert.equal((await callAgentApi(event, { ...options, timeoutMs: 100 })).reason, 'api_timeout');
});
