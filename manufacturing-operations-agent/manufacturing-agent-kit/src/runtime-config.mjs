import { readFileSync } from 'node:fs';

export const RUNTIME_DEFAULTS = Object.freeze(JSON.parse(
  readFileSync(new URL('../config/agent-runtime.json', import.meta.url), 'utf8')));

export function chatEndpoint(baseUrl) {
  if (!baseUrl) return null;
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid API base URL');
  let path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/chat/completions')) path += path.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions';
  url.pathname = path;
  if (url.hostname === 'api.openai.com' && url.protocol !== 'https:')
    throw new Error('OpenAI endpoint requires HTTPS');
  return url.href;
}

export function runtimeConfig(env = process.env, overrides = {}) {
  const baseUrl = overrides.baseUrl ?? env.AGENT_API_BASE_URL ?? RUNTIME_DEFAULTS.baseUrl;
  const model = overrides.model ?? env.AGENT_API_MODEL ?? RUNTIME_DEFAULTS.model;
  const endpoint = chatEndpoint(baseUrl);
  const isOpenAI = endpoint !== null && new URL(endpoint).origin === 'https://api.openai.com';
  // OPENAI_API_KEY must never leak into an alternate/local endpoint.
  const apiKey = overrides.apiKey ?? (isOpenAI ? env.OPENAI_API_KEY || env.AGENT_API_KEY : env.AGENT_API_KEY);
  return {
    baseUrl, endpoint, model, apiKey, isOpenAI,
    timeoutMs: Number(overrides.timeoutMs ?? env.AGENT_API_TIMEOUT_MS ?? RUNTIME_DEFAULTS.timeoutMs),
    reasoningEffort: env.AGENT_REASONING_EFFORT ?? RUNTIME_DEFAULTS.reasoningEffort,
    maxCompletionTokens: Number(env.AGENT_MAX_COMPLETION_TOKENS ?? RUNTIME_DEFAULTS.maxCompletionTokens)
  };
}
