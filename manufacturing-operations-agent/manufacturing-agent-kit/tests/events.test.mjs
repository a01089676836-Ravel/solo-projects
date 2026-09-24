import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, rmdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { loadDevelopmentEvents, openEventStore } from '../src/events.mjs';
import { createApiServer } from '../src/server.mjs';

const events = loadDevelopmentEvents();

test('source import uses fixed validation scores and preserves missing source metadata', () => {
  const baseline = JSON.parse(readFileSync(new URL('../reports/baseline.json', import.meta.url)));
  const model = baseline.models.find(m => m.model === 'max_abs_z');
  assert.equal(events.length, model.validation.tp + model.validation.fp);
  for (const event of events) {
    assert.ok(event.sampleId >= 6101 && event.sampleId <= 8000);
    assert.equal(event.threshold, model.threshold);
    assert.ok(event.score > event.threshold);
    assert.equal(event.synthetic, true);
    assert.equal(event.observedAt, null);
    assert.equal(event.equipmentId, null);
    assert.equal(event.freshness.status, 'unknown');
    assert.equal(event.measurements.length, 5);
    assert.equal(event['Machine failure'], undefined);
  }
  assert.deepEqual(loadDevelopmentEvents(), events);
});

test('SQLite survives reopen, deduplicates import and exposes read-only connection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'manufacturing-events-'));
  const path = join(dir, 'events.sqlite');
  let store;
  try {
    store = openEventStore(path);
    assert.deepEqual(store.save(events), { inserted: events.length, duplicates: 0, total: events.length });
    const original = store.get(events[0].eventId);
    store.close();
    store = openEventStore(path);
    const reversedKeys = Object.fromEntries(Object.entries(events[0]).reverse());
    assert.deepEqual(store.save([reversedKeys]), { inserted: 0, duplicates: 1, total: events.length });
    assert.deepEqual(store.get(events[0].eventId), original);
    store.close();
    store = openEventStore(path, { readOnly: true });
    assert.deepEqual(store.get(events[0].eventId), original);
    assert.throws(() => store.save(events), /Read-only/);
    assert.ok(Number.isFinite(Date.parse(original.storedAt)));
  } finally { store?.close(); unlinkSync(path); rmdirSync(dir); }
});

test('conflicting duplicate rolls back the entire transaction', t => {
  const store = openEventStore(':memory:');
  t.after(() => store.close());
  store.save([events[0]]);
  const conflict = { ...events[0], score: events[0].score + 1 };
  assert.throws(() => store.save([events[1], conflict]), /Conflicting/);
  assert.equal(store.count(), 1);
  assert.equal(store.get(events[1].eventId), null);
  assert.equal(store.get(events[0].eventId).score, events[0].score);
});

test('invalid measurements, test split and fabricated timestamp are rejected before writes', t => {
  const store = openEventStore(':memory:');
  t.after(() => store.close());
  for (const patch of [
    { measurements: [] }, { measurements: events[0].measurements.map(m => ({ ...m, value: NaN })) },
    { sampleSplit: 'test' }, { observedAt: new Date().toISOString() }, { score: Infinity },
    { equipmentId: 'invented-machine' }
  ]) assert.throws(() => store.save([events[1], { ...events[0], ...patch }]));
  assert.equal(store.count(), 0);
});

test('list ordering and pagination are deterministic, including empty results', t => {
  const store = openEventStore(':memory:');
  t.after(() => store.close());
  assert.deepEqual(store.list(), { items: [], total: 0, limit: 50, offset: 0 });
  store.save([...events.slice(0, 3)].reverse());
  assert.deepEqual(store.list(2, 0).items.map(e => e.sampleId), events.slice(0, 2).map(e => e.sampleId));
  assert.equal(store.list(2, 2).items[0].eventId, events[2].eventId);
  assert.equal(store.list(2, 100).items.length, 0);
  assert.throws(() => store.list(101), /pagination/);
  assert.throws(() => store.get("' OR 1=1 --"), /Invalid/);
});

async function startApi(t, store) {
  const server = createApiServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, options = {}) => {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(5000) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
}

test('real HTTP list and detail retrieve the same persisted SQLite event', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'manufacturing-api-'));
  const path = join(dir, 'events.sqlite');
  const writer = openEventStore(path);
  writer.save(events.slice(0, 3));
  writer.close();
  const reader = openEventStore(path, { readOnly: true });
  const request = await startApi(t, reader);
  t.after(() => { reader.close(); unlinkSync(path); rmdirSync(dir); });
  assert.equal((await request('/health')).body.status, 'ok');
  const list = await request('/events?limit=1&offset=1');
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 3);
  assert.equal(list.body.items.length, 1);
  const item = list.body.items[0];
  const detail = await request(`/events/${item.eventId}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body, item);
  assert.equal(detail.headers.get('cache-control'), 'no-store');
  assert.equal(detail.body.freshness.status, 'unknown');
  assert.equal((await request('/events?offset=99')).body.items.length, 0);
});

test('HTTP rejects invalid IDs, bad queries and writes; valid missing ID is 404', async t => {
  const store = openEventStore(':memory:');
  const request = await startApi(t, store);
  t.after(() => store.close());
  assert.equal((await request('/events')).body.total, 0);
  for (const path of ['/events/bad', '/events/', '/events/%27OR%201=1',
    '/events?limit=0', '/events?limit=101', '/events?limit=1.5', '/events?offset=-1',
    '/events?offset=9007199254740992', '/events?limit=1&limit=2', '/events?sql=select', '/health?x=1'])
    assert.equal((await request(path)).status, 400, path);
  const missing = await request(`/events/evt_${'0'.repeat(64)}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'event_not_found');
  assert.equal((await request('/unknown')).status, 404);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await request('/events', { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
  }
  assert.equal(store.count(), 0);
});

test('closed database produces explicit 503 rather than a success or internal error details', async t => {
  const store = openEventStore(':memory:');
  const request = await startApi(t, store);
  store.close();
  for (const path of ['/health', '/events', `/events/${events[0].eventId}`]) {
    const response = await request(path);
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: { code: 'storage_unavailable' } });
  }
});
