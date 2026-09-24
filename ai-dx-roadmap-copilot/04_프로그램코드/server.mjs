import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runCopilot } from './copilot.mjs';
import { createFileStore } from './store.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function defaultTokens(environment) {
  if (environment === 'production') return {};
  return {
    'local-demo-token': {
      userId: 'local-user',
      tenantId: 'tenant-demo',
      workspaceId: 'workspace-demo',
      roles: ['admin', 'reviewer']
    }
  };
}

function parseTokens(environment, configuredTokens) {
  if (configuredTokens) return configuredTokens;
  if (!process.env.DT_PILOT_TOKENS_JSON) return defaultTokens(environment);
  try {
    return JSON.parse(process.env.DT_PILOT_TOKENS_JSON);
  } catch {
    throw new Error('DT_PILOT_TOKENS_JSON must be valid JSON');
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'"
  });
  response.end(body);
}

function sendText(response, status, content, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': contentType.startsWith('text/html')
      ? "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      : "default-src 'none'; frame-ancestors 'none'"
  });
  response.end(content);
}

async function readJsonBody(request, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'payload_too_large', 'request body is too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return body;
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body must be a JSON object');
  }
}

function requireJsonContentType(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'application/json content-type is required');
  }
}

function authenticate(request, config) {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token || !config.tokens[token]) throw new HttpError(401, 'unauthenticated', 'valid bearer token required');
  const principal = config.tokens[token];
  if (!principal?.userId || !principal?.tenantId || !principal?.workspaceId || !Array.isArray(principal.roles)) {
    throw new HttpError(401, 'invalid_principal', 'configured principal is invalid');
  }
  return principal;
}

function requireRole(principal, roles) {
  if (!roles.some(role => principal.roles.includes(role))) {
    throw new HttpError(403, 'forbidden', 'required role is missing');
  }
}

function assertRunAccess(run, principal) {
  if (!run || run.tenantId !== principal.tenantId || run.workspaceId !== principal.workspaceId) {
    throw new HttpError(404, 'run_not_found', 'run not found');
  }
}

function hashInput(input) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function readIdempotencyKey(request) {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || !key || key.length > 128 || !/^[\x21-\x7E]+$/.test(key)) {
    throw new HttpError(400, 'idempotency_key_required', 'a printable Idempotency-Key header up to 128 characters is required');
  }
  return key;
}

function hashIdempotencyScope(principal, key) {
  return createHash('sha256')
    .update(`${principal.tenantId}\0${principal.workspaceId}\0${key}`)
    .digest('hex');
}

function createRunRecord(result, input, principal, now) {
  const createdAt = now();
  return {
    schemaVersion: 1,
    runId: randomUUID(),
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    createdBy: principal.userId,
    createdAt,
    updatedAt: createdAt,
    status: 'review_required',
    inputHash: hashInput(input),
    decisions: [],
    result
  };
}

async function loadFixture(fixturePath) {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

export async function createApp(options = {}) {
  const environment = options.environment ?? process.env.NODE_ENV ?? 'development';
  const storageDir = options.storageDir ?? process.env.DT_STORAGE_DIR ?? path.join(projectRoot, '01_입력데이터_실행기록', '실행기록');
  const fixturePath = options.fixturePath ?? path.join(projectRoot, '01_입력데이터_실행기록', 'candidate-initiatives.json');
  const store = options.store ?? createFileStore({ rootDir: storageDir });
  await store.init();
  const config = {
    environment,
    fixturePath,
    tokens: parseTokens(environment, options.tokens),
    now: options.now ?? (() => new Date().toISOString())
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = url.pathname;

      if (request.method === 'GET' && pathname === '/healthz') {
        return sendJson(response, 200, { status: 'ok', service: 'industrial-automation-dt-copilot', mode: 'pilot-local' });
      }

      if (request.method === 'GET' && pathname === '/') {
        const html = await readFile(path.join(projectRoot, '06_사용자화면', 'index.html'), 'utf8');
        return sendText(response, 200, html, 'text/html; charset=utf-8');
      }

      const principal = authenticate(request, config);

      if (request.method === 'GET' && pathname === '/v1/runs') {
        const runs = (await store.listRuns()).filter(run => run.tenantId === principal.tenantId && run.workspaceId === principal.workspaceId);
        return sendJson(response, 200, { runs });
      }

      if (request.method === 'POST' && pathname === '/v1/runs') {
        const idempotencyKey = readIdempotencyKey(request);
        requireJsonContentType(request);
        const body = await readJsonBody(request);
        let input = body;
        if (body.useFixture === true) {
          if (config.environment === 'production') throw new HttpError(403, 'fixture_disabled', 'fixture mode is disabled in production');
          input = await loadFixture(config.fixturePath);
          if (body.additionalReferenceSources !== undefined) {
            if (!Array.isArray(body.additionalReferenceSources)) {
              throw new HttpError(400, 'invalid_reference_sources', 'additionalReferenceSources must be an array');
            }
            input = {
              ...input,
              referenceSources: [...input.referenceSources, ...body.additionalReferenceSources]
            };
          }
          if (body.additionalCandidate !== undefined) {
            input = {
              ...input,
              candidates: [...input.candidates, body.additionalCandidate]
            };
          }
        }
        const inputHash = hashInput(input);
        const idempotencyId = hashIdempotencyScope(principal, idempotencyKey);
        const previous = await store.getIdempotencyRecord(idempotencyId);
        if (previous) {
          if (previous.inputHash !== inputHash) {
            throw new HttpError(409, 'idempotency_conflict', 'the Idempotency-Key was already used with different input');
          }
          const previousRun = await store.getRun(previous.runId);
          if (!previousRun) throw new HttpError(500, 'idempotency_corrupt', 'idempotency record points to a missing run');
          response.setHeader('idempotency-replayed', 'true');
          return sendJson(response, 200, previousRun);
        }
        let result;
        try {
          result = runCopilot(input);
        } catch (error) {
          throw new HttpError(422, 'invalid_initiative_input', error.message);
        }
        const run = createRunRecord(result, input, principal, config.now);
        const persisted = await store.createRun(run, {
          eventId: randomUUID(),
          type: 'run.created',
          runId: run.runId,
          tenantId: run.tenantId,
          workspaceId: run.workspaceId,
          actorId: principal.userId,
          at: run.createdAt,
          inputHash: run.inputHash,
          resultVersion: result.rubricVersion,
          idempotencyId
        }, {
          idempotencyId,
          tenantId: run.tenantId,
          workspaceId: run.workspaceId,
          inputHash,
          runId: run.runId,
          createdAt: run.createdAt
        });
        if (persisted.replayed) {
          if (persisted.conflict) throw new HttpError(409, 'idempotency_conflict', 'the Idempotency-Key was already used with different input');
          if (!persisted.run) throw new HttpError(500, 'idempotency_corrupt', 'idempotency record points to a missing run');
          response.setHeader('idempotency-replayed', 'true');
          return sendJson(response, 200, persisted.run);
        }
        return sendJson(response, 201, run);
      }

      const runMatch = pathname.match(/^\/v1\/runs\/([^/]+)$/);
      if (request.method === 'GET' && runMatch) {
        const run = await store.getRun(runMatch[1]);
        assertRunAccess(run, principal);
        return sendJson(response, 200, run);
      }

      const decisionMatch = pathname.match(/^\/v1\/runs\/([^/]+)\/decisions$/);
      if (request.method === 'POST' && decisionMatch) {
        requireRole(principal, ['admin', 'reviewer']);
        const run = await store.getRun(decisionMatch[1]);
        assertRunAccess(run, principal);
        requireJsonContentType(request);
        const body = await readJsonBody(request);
        const allowedStatuses = new Set(['approved', 'rejected', 'paused']);
        if (typeof body.candidateId !== 'string' || !allowedStatuses.has(body.status) || typeof body.reason !== 'string' || !body.reason.trim()) {
          throw new HttpError(400, 'invalid_decision', 'candidateId, status, and non-empty reason are required');
        }
        if (!run.result.rankedCandidates.some(candidate => candidate.id === body.candidateId)) {
          throw new HttpError(422, 'unknown_candidate', 'candidate is not part of the run');
        }
        const decision = {
          decisionId: randomUUID(),
          runId: run.runId,
          candidateId: body.candidateId,
          status: body.status,
          reason: body.reason.trim().slice(0, 2000),
          decidedBy: principal.userId,
          decidedAt: config.now()
        };
        const updatedCandidates = run.result.rankedCandidates.map(candidate => candidate.id === decision.candidateId
          ? {
            ...candidate,
            decisionStatus: decision.status,
            decisionReason: decision.reason,
            decisionBy: decision.decidedBy,
            decisionAt: decision.decidedAt
          }
          : candidate);
        const updatedRun = {
          ...run,
          updatedAt: decision.decidedAt,
          decisions: [...run.decisions, decision],
          result: { ...run.result, rankedCandidates: updatedCandidates }
        };
        await store.updateRun(updatedRun, {
          eventId: randomUUID(),
          type: 'decision.recorded',
          runId: run.runId,
          tenantId: run.tenantId,
          workspaceId: run.workspaceId,
          actorId: principal.userId,
          at: decision.decidedAt,
          decisionId: decision.decisionId,
          candidateId: decision.candidateId,
          status: decision.status,
          reason: decision.reason
        });
        return sendJson(response, 200, { decision, run: updatedRun });
      }

      const baselineMatch = pathname.match(/^\/v1\/runs\/([^/]+)\/baselines$/);
      if (request.method === 'POST' && baselineMatch) {
        requireRole(principal, ['admin', 'reviewer']);
        const run = await store.getRun(baselineMatch[1]);
        assertRunAccess(run, principal);
        requireJsonContentType(request);
        const body = await readJsonBody(request);
        if (typeof body.candidateId !== 'string' || typeof body.metric !== 'string' ||
            typeof body.value !== 'number' || !Number.isFinite(body.value) ||
            typeof body.unit !== 'string' || !body.unit.trim() ||
            typeof body.source !== 'string' || !body.source.trim()) {
          throw new HttpError(400, 'invalid_baseline', 'candidateId, metric, finite numeric value, unit, and source are required');
        }
        const kpi = run.result.kpiDrafts.find(item => item.candidateId === body.candidateId);
        if (!kpi) throw new HttpError(422, 'unknown_kpi_candidate', 'candidate has no KPI draft in this run');
        const baseline = {
          baselineId: randomUUID(),
          runId: run.runId,
          candidateId: body.candidateId,
          metric: body.metric.trim().slice(0, 500),
          value: body.value,
          unit: body.unit.trim().slice(0, 100),
          source: body.source.trim().slice(0, 2000),
          recordedBy: principal.userId,
          recordedAt: config.now()
        };
        const updatedKpis = run.result.kpiDrafts.map(item => item.candidateId === body.candidateId
          ? {
            ...item,
            baselineStatus: 'available_for_review',
            baselineValue: baseline.value,
            baselineUnit: baseline.unit,
            baselineSource: baseline.source,
            baselineRecordedAt: baseline.recordedAt,
            target: 'human_review_required'
          }
          : item);
        const updatedRun = {
          ...run,
          updatedAt: baseline.recordedAt,
          baselines: [...(run.baselines ?? []), baseline],
          result: { ...run.result, kpiDrafts: updatedKpis }
        };
        await store.updateRun(updatedRun, {
          eventId: randomUUID(),
          type: 'baseline.recorded',
          runId: run.runId,
          tenantId: run.tenantId,
          workspaceId: run.workspaceId,
          actorId: principal.userId,
          at: baseline.recordedAt,
          baselineId: baseline.baselineId,
          candidateId: baseline.candidateId,
          metric: baseline.metric,
          value: baseline.value,
          unit: baseline.unit,
          source: baseline.source
        });
        return sendJson(response, 200, { baseline, run: updatedRun });
      }

      if (request.method === 'GET' && pathname === '/v1/audit') {
        const runId = url.searchParams.get('runId');
        if (!runId) throw new HttpError(400, 'run_id_required', 'runId query parameter is required');
        const run = await store.getRun(runId);
        assertRunAccess(run, principal);
        const events = (await store.listAudit()).filter(event => event.runId === runId && event.tenantId === principal.tenantId);
        return sendJson(response, 200, { events, integrity: await store.verifyAuditIntegrity() });
      }

      throw new HttpError(404, 'not_found', 'route not found');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : 'internal_error';
      const message = error instanceof HttpError || config.environment !== 'production' ? error.message : 'internal server error';
      return sendJson(response, status, { error: code, message });
    }
  });

  return { server, store, config };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = await createApp();
  const port = Number(process.env.PORT ?? 8766);
  const host = process.env.HOST ?? '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`industrial-automation DT pilot server listening on http://${host}:${port}`);
    console.log('Development bearer token: local-demo-token');
  });
}
