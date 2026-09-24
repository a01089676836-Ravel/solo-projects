import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMaintenance } from '../tools/check-maintenance.mjs';

const current = { nodeVersion: 'v24.19.0', codexVersion: 'codex-cli 0.155.1',
  model: 'gpt-6-astra', fileHashes: { 'config.json': 'aaa' } };
const now = new Date('2026-09-21T12:00:00Z');
const review = { snapshot: current, reviewedAt: '2026-09-21T11:00:00Z' };

test('unchanged reviewed environment avoids unnecessary maintenance', () => {
  assert.equal(assessMaintenance(current, review, now).status, 'current');
});
test('Codex, model or project change triggers review without switching models', () => {
  for (const changed of [{ ...current, codexVersion: 'changed' }, { ...current, model: 'candidate' },
    { ...current, fileHashes: { 'config.json': 'bbb' } }]) {
    const result = assessMaintenance(changed, review, now);
    assert.ok(result.reasons.includes('local_version_or_project_changed'));
    assert.equal(result.automaticModelSwitch, false);
  }
});
test('stale review and unknown versions cannot be treated as up-to-date', () => {
  assert.equal(assessMaintenance(current, { ...review, reviewedAt: '2026-09-01' }, now).status, 'review_required');
  assert.equal(assessMaintenance({ ...current, codexVersion: null }, review, now).status, 'review_required');
  assert.equal(assessMaintenance(current, null, now).status, 'review_required');
});
