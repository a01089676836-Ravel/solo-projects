import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURES, parseDataset, splitRows, fitNormal, score, averagePrecision, evaluate, runExperiment } from '../src/baseline.mjs';

const header = 'UDI,Product ID,Type,Air temperature [K],Process temperature [K],Rotational speed [rpm],Torque [Nm],Tool wear [min],Machine failure,TWF,HDF,PWF,OSF,RNF';
const csv = header + '\n1,M1,M,298,308,1500,40,1,0,0,0,0,0,0';
const rows = Array.from({ length: 30 }, (_, i) => ({ UDI: i + 1, 'Product ID': `M${i + 1}`, Type: 'M',
  ...Object.fromEntries(FEATURES.map((key, j) => [key, 100 + (i % 7) * (j + 1)])),
  'Machine failure': Number(i % 5 === 4), TWF: 0, HDF: 0, PWF: 0, OSF: 0, RNF: 0 }));
const config = { version: 'test', trainEnd: 10, validationStart: 13, validationEnd: 20,
  testStart: 23, normalValidationQuantile: 0.95, models: ['max_abs_z', 'mean_squared_z'] };

test('reject missing, nonfinite, duplicate ID and target contamination', () => {
  assert.equal(parseDataset(csv).length, 1);
  assert.throws(() => parseDataset(csv.replace(',298,', ',,')), /missing/);
  assert.throws(() => parseDataset(csv.replace(',298,', ',NaN,')), /Non-finite/);
  assert.throws(() => parseDataset(csv + '\n' + csv.split('\n')[1]), /UDI/);
  assert.throws(() => parseDataset(csv.replace(/,0$/, ',2')), /target/);
});

test('ordered splits isolate gaps and reject overlapping boundaries', () => {
  const split = splitRows(rows, config);
  assert.deepEqual(split.gap.map(row => row.UDI), [11, 12, 21, 22]);
  assert.equal(new Set(Object.values(split).flat().map(row => row.UDI)).size, rows.length);
  assert.throws(() => splitRows(rows, { ...config, testStart: 19 }), /Overlapping/);
});

test('test changes cannot change preprocessing or thresholds', () => {
  const original = runExperiment(rows, config);
  const changed = rows.map(row => row.UDI >= 23 ? { ...row, 'Torque [Nm]': 1e9, 'Machine failure': 1 } : row);
  const rerun = runExperiment(changed, config);
  assert.deepEqual(original.stats, rerun.stats);
  assert.deepEqual(original.models.map(m => m.threshold), rerun.models.map(m => m.threshold));
  assert.notDeepEqual(original.models[0].test, rerun.models[0].test);
});

test('training failures and outcome flags never affect scoring features', () => {
  const stats = fitNormal(rows.slice(0, 10));
  const altered = rows.slice(0, 10).map(row => row['Machine failure'] ? { ...row, 'Torque [Nm]': 1e12 } : row);
  assert.deepEqual(stats, fitNormal(altered));
  assert.equal(score(rows[0], stats, 'max_abs_z'), score({ ...rows[0], 'Machine failure': 1,
    TWF: 1, HDF: 1, PWF: 1, OSF: 1, RNF: 1, UDI: 999 }, stats, 'max_abs_z'));
});

test('metrics handle ties, known confusion matrix and zero positives', () => {
  const items = [{ score: 3, label: 1 }, { score: 2, label: 0 }, { score: 1, label: 1 }, { score: 0, label: 0 }];
  const metrics = evaluate(items, 1);
  assert.deepEqual([metrics.tp, metrics.fp, metrics.tn, metrics.fn], [1, 1, 1, 1]);
  assert.ok(Math.abs(metrics.averagePrecision - 5 / 6) < 1e-12);
  assert.equal(averagePrecision([{ score: 1, label: 1 }, { score: 1, label: 0 }]), 0.5);
  assert.equal(averagePrecision([{ score: 1, label: 0 }]), null);
});

test('official dataset schema and baseline run are reproducible', () => {
  const data = parseDataset(readFileSync(new URL('../data/raw/ai4i2020/ai4i2020.csv', import.meta.url), 'utf8'));
  const locked = JSON.parse(readFileSync(new URL('../experiment.json', import.meta.url)));
  assert.equal(data.length, 10000);
  const result = runExperiment(data, locked);
  assert.deepEqual(result, runExperiment(data, locked));
  assert.equal(result.splits.train.rows, 6000);
  assert.equal(result.splits.validation.rows, 1900);
  assert.equal(result.splits.test.rows, 1900);
  assert.equal(result.splits.gap.rows, 200);
});
