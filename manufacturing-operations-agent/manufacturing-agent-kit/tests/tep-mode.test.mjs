import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTepBaselines, evaluateTepSeries, normalizeTepRow, readTepJsonl, scoreTepRow, scoreTepSeries } from '../src/tep-mode.mjs';

const files = ['mode_1_normal.jsonl', 'mode_3_normal.jsonl', 'mode_4_normal.jsonl'];
const rows = files.flatMap(file => readTepJsonl(`data/normalized/tep/${file}`));

test('normalized TEP data preserves three process modes and time series', () => {
  assert.equal(rows.length, 9003);
  assert.deepEqual([...new Set(rows.map(row => row.processModeId))].sort(), ['MODE_1', 'MODE_3', 'MODE_4']);
  assert.equal(rows[0].channels['xmv-1'] !== undefined, true);
  assert.ok(rows[1].timeSeconds > rows[0].timeSeconds);
});

test('mode-aware and global baselines use time-ordered holdout data', () => {
  const comparison = compareTepBaselines(rows, { trainFraction: 0.8, normalQuantile: 0.99 });
  assert.equal(comparison.modeAware.model.split.trainRows, 7200);
  assert.equal(comparison.modeAware.model.split.holdoutRows, 1803);
  assert.ok(Number.isFinite(comparison.modeAware.model.modes.MODE_1.threshold));
  assert.ok(Number.isFinite(comparison.global.model.global.threshold));
  assert.ok(comparison.modeAware.evaluation.falseAlarmRate !== null);
  assert.ok(comparison.global.evaluation.falseAlarmRate !== null);
});

test('unknown process mode is withheld instead of scored against another mode', () => {
  const comparison = compareTepBaselines(rows, { trainFraction: 0.8, normalQuantile: 0.99 });
  const unknown = normalizeTepRow({ ...rows[0], processModeId: 'MODE_UNKNOWN' });
  const result = scoreTepRow(unknown, comparison.modeAware.model);
  assert.equal(result.modeKnown, false);
  assert.equal(result.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.score, null);
});

test('temporal scoring waits for persistence before raising an anomaly', () => {
  const comparison = compareTepBaselines(rows, { trainFraction: 0.8, normalQuantile: 0.99 });
  const source = rows.slice(0, 3);
  const anomalous = source.map((row, index) => ({
    ...row, runId: 'temporal-test', timeSeconds: index,
    channels: { ...row.channels, 'xmv-1': row.channels['xmv-1'] + 1000 }
  }));
  const results = scoreTepSeries(anomalous, comparison.modeAware.model, { persistenceRows: 3, transitionGraceRows: 2 });
  assert.deepEqual(results.map(item => item.result.state), ['PENDING_ANOMALY', 'PENDING_ANOMALY', 'ANOMALY']);
  const evaluation = evaluateTepSeries(anomalous, comparison.modeAware.model, { persistenceRows: 3, transitionGraceRows: 2 });
  assert.equal(evaluation.anomalyRows, 1);
  assert.equal(evaluation.pendingRows, 2);
  assert.equal(evaluation.alarmEpisodes, 1);
});

test('mode transition is held for review instead of mixing baselines immediately', () => {
  const comparison = compareTepBaselines(rows, { trainFraction: 0.8, normalQuantile: 0.99 });
  const source = [rows[0], rows[1], rows[3001], rows[3002], rows[3003]];
  const transitioned = source.map((row, index) => ({ ...row, runId: 'transition-test', timeSeconds: index }));
  const results = scoreTepSeries(transitioned, comparison.modeAware.model, { persistenceRows: 2, transitionGraceRows: 2 });
  assert.deepEqual(results.map(item => item.result.state), ['NORMAL', 'NORMAL', 'MODE_TRANSITION', 'MODE_TRANSITION', 'MODE_TRANSITION']);
});
