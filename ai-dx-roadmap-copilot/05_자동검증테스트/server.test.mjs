import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../04_프로그램코드/server.mjs';

let context;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serialTest = (name, callback) => test(name, { concurrency: false }, callback);

async function startServer() {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'industrial-automation-dt-server-'));
  const app = await createApp({
    environment: 'test',
    storageDir,
    tokens: {
      'test-token': { userId: 'test-user', tenantId: 'tenant-a', workspaceId: 'workspace-a', roles: ['admin', 'reviewer'] },
      'other-token': { userId: 'other-user', tenantId: 'tenant-b', workspaceId: 'workspace-b', roles: ['reviewer'] },
      'viewer-token': { userId: 'viewer-user', tenantId: 'tenant-a', workspaceId: 'workspace-a', roles: ['viewer'] }
    }
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  context = { ...app, storageDir, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function request(pathname, { token = 'test-token', ...options } = {}) {
  const requestHeaders = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...(options.headers ?? {})
  };
  if (options.method === 'POST' && pathname === '/v1/runs' && !requestHeaders['idempotency-key'] && !requestHeaders['Idempotency-Key']) {
    requestHeaders['idempotency-key'] = randomUUID();
  }
  const response = await fetch(`${context.baseUrl}${pathname}`, {
    ...options,
    headers: requestHeaders
  });
  const body = await response.json();
  return { response, body };
}

beforeEach(startServer);
afterEach(async () => { await new Promise(resolve => context.server.close(resolve)); });

serialTest('health is public while runs require authentication', async () => {
  const health = await fetch(`${context.baseUrl}/healthz`);
  assert.equal(health.status, 200);
  const unauthorized = await fetch(`${context.baseUrl}/v1/runs`);
  assert.equal(unauthorized.status, 401);
});

serialTest('pilot creates a persisted run with tenant boundary and audit event', async () => {
  const created = await request('/v1/runs', { method: 'POST', body: JSON.stringify({ useFixture: true }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.status, 'review_required');
  assert.equal(created.body.result.externalApiCalled, false);
  const runId = created.body.runId;

  const loaded = await request(`/v1/runs/${runId}`);
  assert.equal(loaded.response.status, 200);
  assert.equal(loaded.body.runId, runId);
  assert.equal(loaded.body.tenantId, 'tenant-a');

  const audit = await request(`/v1/audit?runId=${runId}`);
  assert.equal(audit.response.status, 200);
  assert.equal(audit.body.events.some(event => event.type === 'run.created'), true);
  assert.equal(audit.body.integrity.valid, true);
  assert.equal(audit.body.events.every(event => typeof event.eventHash === 'string'), true);
});

serialTest('audit integrity detects a modified audit event', async () => {
  const created = await request('/v1/runs', { method: 'POST', body: JSON.stringify({ useFixture: true }) });
  const auditPath = path.join(context.storageDir, 'audit.jsonl');
  const lines = (await readFile(auditPath, 'utf8')).trim().split('\n');
  const firstEvent = JSON.parse(lines[0]);
  firstEvent.actorId = 'tampered-user';
  lines[0] = JSON.stringify(firstEvent);
  await writeFile(auditPath, `${lines.join('\n')}\n`, 'utf8');

  const audit = await request(`/v1/audit?runId=${created.body.runId}`);
  assert.equal(audit.response.status, 200);
  assert.equal(audit.body.integrity.valid, false);
});

serialTest('run creation is idempotent and rejects key reuse with different input', async () => {
  const headers = { 'idempotency-key': 'replay-key-001' };
  const first = await request('/v1/runs', { method: 'POST', headers, body: JSON.stringify({ useFixture: true }) });
  const replay = await request('/v1/runs', { method: 'POST', headers, body: JSON.stringify({ useFixture: true }) });
  const conflict = await request('/v1/runs', { method: 'POST', headers, body: JSON.stringify({ useFixture: false }) });
  assert.equal(first.response.status, 201);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.response.headers.get('idempotency-replayed'), 'true');
  assert.equal(replay.body.runId, first.body.runId);
  assert.equal(conflict.response.status, 409);

  const concurrentHeaders = { 'idempotency-key': 'parallel-key-001' };
  const concurrent = await Promise.all([
    request('/v1/runs', { method: 'POST', headers: concurrentHeaders, body: JSON.stringify({ useFixture: true }) }),
    request('/v1/runs', { method: 'POST', headers: concurrentHeaders, body: JSON.stringify({ useFixture: true }) })
  ]);
  assert.deepEqual(concurrent.map(item => item.response.status).sort(), [200, 201]);
  assert.equal(concurrent[0].body.runId, concurrent[1].body.runId);

  const runs = await request('/v1/runs');
  assert.equal(runs.body.runs.length, 2);
});

serialTest('run creation requires an idempotency key', async () => {
  const response = await fetch(`${context.baseUrl}/v1/runs`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ useFixture: true })
  });
  assert.equal(response.status, 400);

  const unsupported = await fetch(`${context.baseUrl}/v1/runs`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'idempotency-key': 'content-type-test' },
    body: JSON.stringify({ useFixture: true })
  });
  assert.equal(unsupported.status, 415);
});

serialTest('pilot can compare a user-supplied candidate with the fixture candidates', async () => {
  const customCandidate = {
    id: 'custom-001',
    title: '사용자 입력 AX 후보',
    problem: '반복적인 현장 문서 확인으로 의사결정이 지연된다.',
    owner: '사용자 입력 조직',
    strategicFit: 5,
    businessImpact: 4,
    feasibility: 3,
    dataReadiness: 3,
    urgency: 4,
    governanceReadiness: 3,
    evidenceRefs: ['custom-source-001'],
    humanDecisionPoints: ['과제 목표 승인'],
    baselineAvailable: false,
    existingPortfolio: false,
    overlapRisk: 'low',
    tags: ['custom-input'],
    kpiHints: {
      objective: '현장 문서 확인 업무의 실행 가능성과 성과를 검증한다.',
      leadingIndicator: '문서 검색 성공률',
      outcomeIndicator: '문서 확인 소요시간',
      unit: '분',
      baselineSource: '실제 업무 로그 측정 필요'
    }
  };
  const created = await request('/v1/runs', {
    method: 'POST',
    body: JSON.stringify({
      useFixture: true,
      additionalReferenceSources: [{
        id: 'custom-source-001',
        title: '사용자 입력 공개자료',
        url: 'https://example.com/dx-source',
        role: 'user_supplied_reference'
      }],
      additionalCandidate: customCandidate
    })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.result.rankedCandidates.some(candidate => candidate.id === 'custom-001'), true);
  assert.equal(created.body.result.evidenceTrace.referenceSources.some(source => source.id === 'custom-source-001'), true);
});

serialTest('invalid user-supplied candidate is rejected before persistence', async () => {
  const result = await request('/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ useFixture: true, additionalCandidate: { id: 'bad-001', title: '불완전 후보' } })
  });
  assert.equal(result.response.status, 422);
  const runs = await request('/v1/runs');
  assert.equal(runs.body.runs.length, 0);
});

serialTest('invalid user-supplied reference source is rejected before persistence', async () => {
  const result = await request('/v1/runs', {
    method: 'POST',
    body: JSON.stringify({
      useFixture: true,
      additionalReferenceSources: [{ id: 'bad-source', title: '잘못된 출처', url: 'javascript:alert(1)' }]
    })
  });
  assert.equal(result.response.status, 422);
  const runs = await request('/v1/runs');
  assert.equal(runs.body.runs.length, 0);
});

serialTest('human reviewer can record a candidate decision and the audit trail grows', async () => {
  const created = await request('/v1/runs', { method: 'POST', body: JSON.stringify({ useFixture: true }) });
  const decision = await request(`/v1/runs/${created.body.runId}/decisions`, {
    method: 'POST',
    body: JSON.stringify({ candidateId: 'dx-001', status: 'approved', reason: '파일럿 후보로 검토할 가치가 있음' })
  });
  assert.equal(decision.response.status, 200);
  assert.equal(decision.body.decision.status, 'approved');
  assert.equal(decision.body.run.decisions.length, 1);
  const updatedCandidate = decision.body.run.result.rankedCandidates.find(candidate => candidate.id === 'dx-001');
  assert.equal(updatedCandidate.decisionStatus, 'approved');
  assert.equal(updatedCandidate.decisionReason, '파일럿 후보로 검토할 가치가 있음');

  const audit = await request(`/v1/audit?runId=${created.body.runId}`);
  assert.equal(audit.body.events.some(event => event.type === 'decision.recorded' && event.reason === '파일럿 후보로 검토할 가치가 있음'), true);
});

serialTest('viewer can read a run but cannot record a human decision', async () => {
  const created = await request('/v1/runs', { method: 'POST', body: JSON.stringify({ useFixture: true }) });
  const loaded = await request(`/v1/runs/${created.body.runId}`, { token: 'viewer-token' });
  assert.equal(loaded.response.status, 200);
  const decision = await request(`/v1/runs/${created.body.runId}/decisions`, {
    token: 'viewer-token',
    method: 'POST',
    body: JSON.stringify({ candidateId: 'dx-001', status: 'approved', reason: '읽기 전용 사용자의 승인 시도' })
  });
  assert.equal(decision.response.status, 403);
});

serialTest('production mode does not install the local demo token', async () => {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'industrial-automation-dt-production-'));
  const production = await createApp({ environment: 'production', storageDir });
  await new Promise(resolve => production.server.listen(0, '127.0.0.1', resolve));
  const address = production.server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/runs`, {
      headers: { authorization: 'Bearer local-demo-token' }
    });
    assert.equal(response.status, 401);
    assert.deepEqual(production.config.tokens, {});
  } finally {
    await new Promise(resolve => production.server.close(resolve));
  }
});

serialTest('reviewer can record a KPI baseline with its measurement source', async () => {
  const created = await request('/v1/runs', { method: 'POST', body: JSON.stringify({ useFixture: true }) });
  const kpi = created.body.result.kpiDrafts.find(item => item.candidateId === 'dx-001');
  const baseline = await request(`/v1/runs/${created.body.runId}/baselines`, {
    method: 'POST',
    body: JSON.stringify({ candidateId: 'dx-001', metric: kpi.outcomeIndicator, value: 12.5, unit: '일', source: '가상 업무 승인 로그' })
  });
  assert.equal(baseline.response.status, 200);
  assert.equal(baseline.body.baseline.value, 12.5);
  assert.equal(baseline.body.run.result.kpiDrafts.find(item => item.candidateId === 'dx-001').baselineStatus, 'available_for_review');

  const audit = await request(`/v1/audit?runId=${created.body.runId}`);
  assert.equal(audit.body.events.some(event => event.type === 'baseline.recorded' && event.value === 12.5 && event.source === '가상 업무 승인 로그'), true);
});

serialTest('invalid KPI baseline is rejected', async () => {
  const created = await request('/v1/runs', { method: 'POST', body: JSON.stringify({ useFixture: true }) });
  const result = await request(`/v1/runs/${created.body.runId}/baselines`, {
    method: 'POST',
    body: JSON.stringify({ candidateId: 'dx-001', metric: 'metric', value: 'unknown', unit: '일', source: '' })
  });
  assert.equal(result.response.status, 400);
});

serialTest('tenant boundary hides another tenant run', async () => {
  const created = await request('/v1/runs', { method: 'POST', body: JSON.stringify({ useFixture: true }) });
  const other = await request(`/v1/runs/${created.body.runId}`, { token: 'other-token' });
  assert.equal(other.response.status, 404);
});

serialTest('invalid evidence is rejected before persistence', async () => {
  const fixture = JSON.parse(await readFile(path.join(projectRoot, '01_입력데이터_실행기록', 'candidate-initiatives.json'), 'utf8'));
  fixture.candidates[0].evidenceRefs = ['not-registered'];
  const result = await request('/v1/runs', { method: 'POST', body: JSON.stringify(fixture) });
  assert.equal(result.response.status, 422);
  const runs = await request('/v1/runs');
  assert.equal(runs.body.runs.length, 0);
});

serialTest('local pilot serves the human-readable web screen', async () => {
  const page = await fetch(`${context.baseUrl}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy'), /script-src 'unsafe-inline'/);
  assert.match(await page.text(), /AI\/DX/);
});
