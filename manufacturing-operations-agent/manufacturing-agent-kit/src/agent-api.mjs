import {
  DEFAULT_SOP_INDEX, inspectWindow, runMaintenanceAgent, runScenario, trainDemoModel
} from './agent-harness.mjs';
import { attachMesContext, createVirtualMesContext } from './mes-lite.mjs';
import { buildSkillContext } from './skill-registry.mjs';
import { runtimeConfig } from './runtime-config.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ALLOWED_STATUS = new Set(['ok', 'insufficient_evidence', 'conflict', 'unavailable']);
// Only known diagnostic labels may leave the HTTP boundary. Never log provider
// messages, which may echo credentials, request content or account identifiers.
const SAFE_ERROR_CODES = new Set(['insufficient_quota', 'credit_balance_exhausted',
  'organization_spend_limit_exceeded', 'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded', 'rate_limit_exceeded', 'slow_down',
  'invalid_api_key', 'model_not_found', 'server_is_overloaded']);
const SAFE_ERROR_TYPES = new Set(['insufficient_quota', 'rate_limit_error',
  'invalid_request_error', 'authentication_error', 'permission_error',
  'server_error', 'service_unavailable_error']);

function arrayOfStrings(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length > 2000))
    throw new Error(`Invalid ${field}`);
  return value;
}

function expectedStatus(event) {
  return event.state === 'NORMAL' ? 'ok' : 'insufficient_evidence';
}

function responseFormatFor(event) {
  const status = expectedStatus(event);
  const humanConfirmation = event.state !== 'NORMAL';
  const evidenceIds = event.evidence.map((_, index) => `e${index}`);
  const localSopIds = runMaintenanceAgent(event).evidenceRefs.map(reference => reference.documentId);
  // Do not let a remote model choose an unrelated approved SOP merely because
  // it exists in the global index. If local retrieval found no SOP, the
  // grounding gate must keep the result unavailable instead of guessing.
  const sopIds = localSopIds;
  const requiresSop = event.state !== 'NORMAL' && localSopIds.length > 0;
  const arrayConstraint = (allowed, required) => allowed.length
    ? { type: 'array', items: { type: 'string', enum: allowed }, minItems: required ? 1 : 0, maxItems: allowed.length }
    : { type: 'array', items: { type: 'string' }, maxItems: 0 };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'grounded_agent_selection',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: [status] },
          evidenceIds: arrayConstraint(evidenceIds, event.state !== 'NORMAL'),
          sopIds: arrayConstraint(event.state === 'NORMAL' ? [] : sopIds, requiresSop),
          requiresHumanConfirmation: { type: 'boolean', enum: [humanConfirmation] }
        },
        required: ['status', 'evidenceIds', 'sopIds', 'requiresHumanConfirmation'],
        additionalProperties: false
      }
    }
  };
}

export function buildAgentMessages(event) {
  const skills = buildSkillContext(event);
  const facts = {
    state: event.state,
    severity: event.severity,
    anomalyScore: event.anomalyScore,
    threshold: event.threshold,
    features: event.features,
    evidence: event.evidence,
    limitations: event.limitations,
    actuator: event.actuator,
    mesContext: event.mesContext ?? null,
    activeSkills: skills.map(skill => ({ id: skill.id, version: skill.version })),
    evidenceCatalog: event.evidence.map((text, index) => ({ id: `e${index}`, text })),
    sopCatalog: DEFAULT_SOP_INDEX.filter(sop => runMaintenanceAgent(event).evidenceRefs
      .some(ref => ref.documentId === sop.id)).map(sop => ({ id: sop.id, title: sop.title,
        steps: sop.steps, sourceType: 'project-demo-procedure-not-field-approved' }))
  };
  return [
    {
      role: 'system',
      content: [
        'You are a maintenance guidance agent for an edge anomaly detector.',
        'Use only the supplied facts and approved SOP context.',
        'Do not claim a confirmed failure or invent a root cause.',
        'Do not issue GPIO, motor, LED, buzzer, or emergency-stop commands.',
        'Do not invent or modify work orders, lots, operations, equipment modes, or execution states.',
        'Select only supplied evidence IDs and approved SOP IDs. Do not invent measurements, causes, or procedures.',
        `Active runtime skills: ${skills.map(skill => `${skill.id}@${skill.version}`).join(', ')}.`,
        skills.map(skill => skill.prompt).join(' '),
        `Return JSON only. For this event, status must be exactly ${expectedStatus(event)}.`,
        'Required shape example: {"status":"insufficient_evidence","evidenceIds":["e0"],"sopIds":["sop-temperature-001"],"requiresHumanConfirmation":true}.'
      ].join(' ')
    },
    { role: 'user', content: JSON.stringify({ task: 'Explain the incident and recommend safe checks.', facts }) }
  ];
}

export function parseAgentJson(content) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('Empty Agent response');
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let value;
  try { value = JSON.parse(cleaned); }
  catch { throw new Error('Agent response was not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent response must be an object');
  if (!ALLOWED_STATUS.has(value.status)) throw new Error('Invalid Agent status');
  const observations = arrayOfStrings(value.observations ?? [], 'observations');
  const hypotheses = arrayOfStrings(value.hypotheses ?? [], 'hypotheses');
  const recommendedChecks = arrayOfStrings(value.recommendedChecks ?? [], 'recommendedChecks');
  const limitations = arrayOfStrings(value.limitations ?? [], 'limitations');
  if (typeof value.requiresHumanConfirmation !== 'boolean') throw new Error('Invalid confirmation flag');
  if (!Array.isArray(value.evidenceIds) || value.evidenceIds.some(id => typeof id !== 'string'))
    throw new Error('Invalid evidenceIds');
  if (!Array.isArray(value.sopIds) || value.sopIds.some(id => typeof id !== 'string'))
    throw new Error('Invalid sopIds');
  return { status: value.status, observations, hypotheses, recommendedChecks, limitations,
    evidenceIds: value.evidenceIds, sopIds: value.sopIds,
    requiresHumanConfirmation: value.requiresHumanConfirmation };
}

export function groundedRemotePlan(event, remote) {
  const local = runMaintenanceAgent(event);
  const evidenceIndexes = remote.evidenceIds.map(id => {
    const match = /^e(\d+)$/.exec(id);
    return match ? Number(match[1]) : -1;
  });
  const validEvidence = evidenceIndexes.every(index => Number.isInteger(index) && index >= 0 && index < event.evidence.length);
  const uniqueEvidence = new Set(remote.evidenceIds).size === remote.evidenceIds.length;
  const uniqueSops = new Set(remote.sopIds).size === remote.sopIds.length;
  const allowedSopIds = new Set(local.evidenceRefs.map(reference => reference.documentId));
  const selectedSops = DEFAULT_SOP_INDEX.filter(sop => allowedSopIds.has(sop.id) && remote.sopIds.includes(sop.id));
  const onlyAllowedSops = remote.sopIds.every(id => allowedSopIds.has(id));
  const requiresEvidence = event.state !== 'NORMAL';
  if (!validEvidence || !uniqueEvidence || !uniqueSops || !onlyAllowedSops ||
      remote.requiresHumanConfirmation !== requiresEvidence ||
      (requiresEvidence && !evidenceIndexes.length) ||
      (requiresEvidence && !selectedSops.length) || remote.status !== (event.state === 'NORMAL' ? 'ok' : 'insufficient_evidence'))
    throw new Error('Ungrounded remote Agent selection');
  const observations = evidenceIndexes.map(index => event.evidence[index]);
  const recommendedChecks = selectedSops.flatMap(sop => sop.steps);
  return {
    status: event.state === 'NORMAL' ? 'ok' : 'insufficient_evidence',
    observations: observations.length ? observations : local.observations,
    hypotheses: local.hypotheses,
    recommendedChecks: recommendedChecks.length ? recommendedChecks : local.recommendedChecks,
    limitations: [...new Set([...(local.limitations ?? event.limitations ?? []), '원격 Agent의 자유 문장은 사용하지 않고 검증된 이벤트·SOP 근거로 재구성했습니다.'])],
    requiresHumanConfirmation: event.state !== 'NORMAL',
    toolTrace: [{ tool: 'remote_agent_api', input: { model: 'configured' }, resultCount: 1 },
      { tool: 'grounding_gate', input: { evidenceIds: remote.evidenceIds, sopIds: remote.sopIds }, resultCount: 1 }],
    evidenceRefs: selectedSops.map(sop => ({ documentId: sop.id, title: sop.title, source: 'local-approved-sop-index' })),
    hallucinationGate: 'grounded_structured_selection'
  };
}

function contentFromResponse(body) {
  const content = body?.choices?.[0]?.message?.content ?? body?.output_text ?? body?.response?.output_text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part?.text ?? '').join('');
  return null;
}

export async function callAgentApi(event, options = {}) {
  const fallback = reason => ({ mode: 'fallback', reason, model: null, plan: runMaintenanceAgent(event) });
  let config;
  try { config = runtimeConfig(options.env ?? process.env, options); }
  catch { return fallback('invalid_api_config'); }
  const offline = options.offline === true || (options.env ?? process.env).AGENT_RUNTIME_MODE === 'offline';
  if (offline) return fallback('offline_mode');
  const { endpoint, model, apiKey, timeoutMs, isOpenAI, reasoningEffort, maxCompletionTokens } = config;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!endpoint || typeof fetchImpl !== 'function') return fallback('api_not_configured');
  if (isOpenAI && !apiKey) return fallback('missing_api_key');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) return fallback('invalid_timeout');
  if (model === 'gpt-6-astra' && (!['low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort) ||
      !Number.isInteger(maxCompletionTokens) || maxCompletionTokens < 128 || maxCompletionTokens > 8192))
    return fallback('invalid_model_parameters');
  if (event.state !== 'NORMAL' && !runMaintenanceAgent(event).evidenceRefs.length)
    return fallback('no_sop_evidence');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestBody = {
      model,
      response_format: responseFormatFor(event),
      messages: buildAgentMessages(event)
    };
    // GPT-6 Astra's official migration guidance requires removing sampling
    // parameters such as temperature. The local Qwen-compatible endpoint
    // retains temperature=0 for deterministic demo behavior.
    if (model !== 'gpt-6-astra') requestBody.temperature = 0;
    else {
      requestBody.reasoning_effort = reasoningEffort;
      requestBody.max_completion_tokens = maxCompletionTokens;
      requestBody.store = false;
    }
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      let error;
      try { error = (await response.json())?.error; } catch { /* Keep HTTP status even for non-JSON errors. */ }
      return { ...fallback(`api_http_${response.status}`), apiError: {
        code: SAFE_ERROR_CODES.has(error?.code) ? error.code : null,
        type: SAFE_ERROR_TYPES.has(error?.type) ? error.type : null
      } };
    }
    const body = await response.json();
    const choice = body?.choices?.[0];
    if (choice?.message?.refusal) return fallback('api_refusal');
    if (choice?.finish_reason && choice.finish_reason !== 'stop') return fallback('api_incomplete');
    const remote = parseAgentJson(contentFromResponse(body));
    const plan = groundedRemotePlan(event, remote);
    const usage = body?.usage;
    const safeUsage = usage ? Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens']
      .filter(key => Number.isFinite(usage[key])).map(key => [key, usage[key]])) : null;
    return { mode: 'remote_api', model, endpoint, usage: safeUsage, plan: {
      ...plan,
      limitations: [...new Set([...plan.limitations, '원격 Agent 응답은 안전 제어 명령으로 사용하지 않습니다.'])]
    } };
  } catch (error) {
    return fallback(error?.name === 'AbortError' ? 'api_timeout' : 'api_unavailable');
  } finally { clearTimeout(timer); }
}

export async function runIncidentWithAgent(scenario = 'temperature_rise', options = {}) {
  const model = options.modelForDetection ?? trainDemoModel();
  const detected = runScenario(scenario, model, options);
  const mesContext = options.mesContext ?? (options.useVirtualMes
    ? createVirtualMesContext({ runId: detected.runId }) : null);
  const event = mesContext ? attachMesContext(detected, mesContext) : detected;
  const agent = await callAgentApi(event, options);
  return { event, agent };
}

export async function runObservationsWithAgent(observations, options = {}) {
  if (!Array.isArray(observations) || observations.length < 2)
    throw new Error('At least two observations are required');
  if (!options.modelForDetection)
    throw new Error('modelForDetection is required for live observation processing');
  const detected = inspectWindow(observations, options.modelForDetection, options);
  const mesContext = options.mesContext ?? null;
  const event = mesContext ? attachMesContext(detected, mesContext) : detected;
  const agent = await callAgentApi(event, options);
  return { event, agent };
}

export function agentApiConfigFromEnv(env = process.env) {
  const config = runtimeConfig(env);
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    keyConfigured: Boolean(config.apiKey)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--config')) {
    console.log(JSON.stringify(agentApiConfigFromEnv(), null, 2));
  } else {
  const scenario = process.argv[2] ?? 'temperature_rise';
  const result = await runIncidentWithAgent(scenario, { useVirtualMes: process.argv.includes('--virtual-mes') });
  console.log(JSON.stringify({ scenario, mode: result.agent.mode, event: result.event,
    agentPlan: result.agent.plan, config: agentApiConfigFromEnv() }, null, 2));
  }
}
