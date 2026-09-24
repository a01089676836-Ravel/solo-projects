import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/events.mjs';

const base = 'http://127.0.0.1:8765';
async function get(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, path);
  return response.json();
}
const health = await get('/health');
assert.equal(health.status, 'ok');
const list = await get('/events?limit=1');
assert.ok(list.total > 0);
assert.equal(list.items.length, 1);
const detail = await get(`/events/${list.items[0].eventId}`);
assert.deepEqual(detail, list.items[0]);
assert.equal(detail.sampleSplit, 'validation');
assert.equal(detail.synthetic, true);
assert.equal(detail.observedAt, null);
assert.equal(detail.freshness.status, 'unknown');
const result = { checkedAt: new Date().toISOString(), node: process.version,
  status: 'PASS', base, totalEvents: list.total, eventId: detail.eventId,
  sampleId: detail.sampleId, datasetSHA256: detail.datasetSHA256,
  modelFingerprint: detail.modelFingerprint,
  checks: ['CLI server health', 'persisted event list', 'list/detail equality', 'source metadata preserved'] };
mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
writeFileSync(resolve(ROOT, 'reports/api-smoke.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
