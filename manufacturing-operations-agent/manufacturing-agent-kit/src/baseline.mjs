import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

export const FEATURES = ['Air temperature [K]', 'Process temperature [K]',
  'Rotational speed [rpm]', 'Torque [Nm]', 'Tool wear [min]'];
const TARGETS = ['Machine failure', 'TWF', 'HDF', 'PWF', 'OSF', 'RNF'];
const HEADER = ['UDI', 'Product ID', 'Type', ...FEATURES, ...TARGETS];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');

// This parser intentionally accepts only the simple, unquoted official CSV schema.
export function parseDataset(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.shift() !== HEADER.join(',')) throw new Error('Unexpected CSV schema');
  const ids = new Set();
  return lines.map((line, index) => {
    const cells = line.split(',');
    if (cells.length !== HEADER.length || cells.some(c => !c.trim() || c.includes('"')))
      throw new Error(`Invalid or missing cell at row ${index + 2}`);
    const row = Object.fromEntries(HEADER.map((key, i) => [key, cells[i]]));
    for (const key of ['UDI', ...FEATURES, ...TARGETS]) {
      row[key] = Number(row[key]);
      if (!Number.isFinite(row[key])) throw new Error(`Non-finite ${key}`);
    }
    if (!Number.isInteger(row.UDI) || row.UDI !== index + 1 || ids.has(row.UDI))
      throw new Error('UDI must be unique and in original contiguous order');
    ids.add(row.UDI);
    if (!['L', 'M', 'H'].includes(row.Type) || !/^[LMH]\d+$/.test(row['Product ID']) ||
        row['Product ID'][0] !== row.Type) throw new Error('Invalid product category');
    if (TARGETS.some(key => ![0, 1].includes(row[key]))) throw new Error('Invalid target');
    if (FEATURES.some(key => row[key] < 0) || row['Rotational speed [rpm]'] === 0)
      throw new Error('Invalid physical value');
    return row;
  });
}

export function splitRows(rows, config) {
  if (!(config.trainEnd < config.validationStart && config.validationStart <= config.validationEnd &&
      config.validationEnd < config.testStart)) throw new Error('Overlapping split boundaries');
  const split = { train: [], validation: [], test: [], gap: [] };
  for (const row of rows) {
    const key = row.UDI <= config.trainEnd ? 'train' :
      row.UDI >= config.validationStart && row.UDI <= config.validationEnd ? 'validation' :
      row.UDI >= config.testStart ? 'test' : 'gap';
    split[key].push(row);
  }
  for (const key of ['train', 'validation', 'test'])
    if (!split[key].length) throw new Error(`Empty ${key} split`);
  return split;
}

export function fitNormal(train) {
  const normal = train.filter(row => row['Machine failure'] === 0);
  if (normal.length < 2) throw new Error('Need at least two normal training rows');
  return FEATURES.map(feature => {
    const mean = normal.reduce((sum, row) => sum + row[feature], 0) / normal.length;
    const std = Math.sqrt(normal.reduce((sum, row) => sum + (row[feature] - mean) ** 2, 0) / normal.length);
    if (!std) throw new Error(`Constant training feature: ${feature}`);
    return { feature, mean, std };
  });
}

export function score(row, stats, model) {
  const z = stats.map(({ feature, mean, std }) => (row[feature] - mean) / std);
  if (model === 'max_abs_z') return Math.max(...z.map(Math.abs));
  if (model === 'mean_squared_z') return z.reduce((sum, value) => sum + value ** 2, 0) / z.length;
  throw new Error(`Unknown model: ${model}`);
}

export function quantile(values, q) {
  if (!values.length || q < 0 || q > 1) throw new Error('Invalid quantile');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

// Non-interpolated average precision; equal-score observations form one threshold.
export function averagePrecision(items) {
  const positives = items.reduce((sum, item) => sum + item.label, 0);
  if (!positives) return null;
  const sorted = [...items].sort((a, b) => b.score - a.score);
  let tp = 0, seen = 0, ap = 0;
  while (seen < sorted.length) {
    const current = sorted[seen].score;
    let added = 0;
    do { added += sorted[seen].label; seen++; }
    while (seen < sorted.length && sorted[seen].score === current);
    tp += added;
    ap += (added / positives) * (tp / seen);
  }
  return ap;
}

export function evaluate(items, threshold) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const item of items) {
    if (item.score > threshold) { if (item.label) tp++; else fp++; }
    else { if (item.label) fn++; else tn++; }
  }
  return { rows: items.length, positives: tp + fn, tp, fp, tn, fn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    falsePositiveRate: fp + tn ? fp / (fp + tn) : null,
    averagePrecision: averagePrecision(items), prevalence: (tp + fn) / items.length };
}

export function runExperiment(rows, config) {
  const split = splitRows(rows, config);
  const stats = fitNormal(split.train);
  const models = config.models.map(model => {
    const threshold = quantile(split.validation.filter(row => !row['Machine failure'])
      .map(row => score(row, stats, model)), config.normalValidationQuantile);
    const scored = subset => subset.map(row => ({ id: row.UDI, label: row['Machine failure'],
      score: score(row, stats, model) }));
    return { model, threshold, validation: evaluate(scored(split.validation), threshold),
      test: evaluate(scored(split.test), threshold) };
  });
  const splits = Object.fromEntries(Object.entries(split).map(([name, subset]) => [name, {
    rows: subset.length, positives: subset.filter(row => row['Machine failure']).length,
    firstUDI: subset[0]?.UDI ?? null, lastUDI: subset.at(-1)?.UDI ?? null
  }]));
  const disagreements = rows.filter(row => row['Machine failure'] !== Number(TARGETS.slice(1).some(key => row[key])));
  return { version: config.version, synthetic: true, task: 'tabular normal-reference anomaly scoring',
    splitPolicy: 'ordered UDI blocks; 100-row gaps; no verified timestamp or independent machine/run identity',
    thresholdPolicy: 'score > normal-validation nearest-rank 95th percentile; no test tuning',
    features: FEATURES, stats, splits, audit: { rows: rows.length,
      duplicateProductIds: rows.length - new Set(rows.map(row => row['Product ID'])).size,
      targetDisagreements: disagreements.length, targetDisagreementUDIs: disagreements.map(row => row.UDI) },
    models, limitations: ['Synthetic data, not field validation',
      'UDI is not elapsed time; no event recall, lead time or alarms/day claims',
      'Failure labels used only to select normal train/calibration rows and evaluate scores',
      'Failure-mode flags and identifiers are excluded from model features',
      'Block gaps do not prove run independence; no automatic model winner selection',
      'Normal-reference scores are not calibrated failure probabilities'] };
}

function main() {
  const configBytes = readFileSync(resolve(root, 'experiment.json'));
  const config = JSON.parse(configBytes);
  const bytes = readFileSync(resolve(root, config.csv));
  if (sha256(bytes) !== config.sha256) throw new Error('Dataset checksum mismatch');
  const rows = parseDataset(bytes.toString('utf8'));
  if (rows.length !== config.expectedRows) throw new Error('Unexpected row count');
  const result = runExperiment(rows, config);
  result.provenance = { generatedAt: new Date().toISOString(), node: process.version,
    datasetSHA256: sha256(bytes), configSHA256: sha256(configBytes),
    codeSHA256: sha256(readFileSync(fileURLToPath(import.meta.url))) };
  mkdirSync(resolve(root, 'reports'), { recursive: true });
  writeFileSync(resolve(root, 'reports/baseline.json'), JSON.stringify(result, null, 2) + '\n');
  const pct = value => value === null ? 'N/A' : (value * 100).toFixed(2) + '%';
  const report = ['# 첫 기준선 실험 결과', '', 'UCI AI4I 합성 데이터의 표형 이상 점수 실험. 실제 공장 성능이 아님.', '',
    '| 방법 | Test precision | Test recall | 정상 표본 오경보율 | Average precision |',
    '|---|---:|---:|---:|---:|',
    ...result.models.map(m => `| ${m.model} | ${pct(m.test.precision)} | ${pct(m.test.recall)} | ${pct(m.test.falsePositiveRate)} | ${m.test.averagePrecision.toFixed(4)} |`),
    '', `Test 표본 ${result.splits.test.rows}개, 고장 라벨 ${result.splits.test.positives}개.`,
    `목표 라벨과 고장 유형 OR의 불일치: ${result.audit.targetDisagreements}개. 원본을 수정하지 않고 Machine failure를 평가 기준으로 유지.`,
    '', 'AP는 동점 점수를 묶은 비보간 average precision이며 사다리꼴 PR-AUC와 구분한다.',
    '임계값은 정상 validation 점수의 95백분위에서 고정했다. Test 결과를 보고 조정하지 않았다.',
    '정상 데이터의 평균·표준편차는 train에서만 계산했다. 두 방법은 동일한 다섯 센서·운전 변수와 분할을 사용한다.',
    'UDI 순서 블록과 100행 gap은 실험 설계이며 실제 시간·설비 독립성을 보증하지 않는다.',
    '', '재현: `node src/baseline.mjs` / 검증: `node --test tests/baseline.test.mjs`',
    '상세 지표·분할·정규화 계수·데이터/코드/설정 해시는 baseline.json 참조.', ''];
  writeFileSync(resolve(root, 'reports/baseline.md'), report.join('\n'));
  console.log(JSON.stringify({ audit: result.audit, splits: result.splits, models: result.models }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
