import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const finite = value => typeof value === 'number' && Number.isFinite(value);

export function normalizeTepRow(input) {
  if (!input || typeof input !== 'object') throw new Error('TEP row must be an object');
  if (input.schemaVersion !== 1 || input.source !== 'tennessee-eastman-dataset')
    throw new Error('Unsupported TEP row schema');
  for (const field of ['processModeId', 'scenarioType', 'runId']) {
    if (typeof input[field] !== 'string' || !input[field]) throw new Error(`Invalid TEP ${field}`);
  }
  if (!finite(input.timeSeconds) || input.timeSeconds < 0) throw new Error('Invalid TEP timeSeconds');
  if (!input.channels || typeof input.channels !== 'object' || Array.isArray(input.channels))
    throw new Error('Invalid TEP channels');
  const channels = Object.fromEntries(Object.entries(input.channels).map(([name, value]) => {
    if (!/^xmv-\d+$/.test(name) || !finite(value)) throw new Error(`Invalid TEP channel: ${name}`);
    return [name, value];
  }));
  return { schemaVersion: 1, source: input.source, sourceFile: input.sourceFile ?? null,
    processModeId: input.processModeId, scenarioType: input.scenarioType, runId: input.runId,
    timeSeconds: input.timeSeconds, channels };
}

export function readTepJsonl(filePath) {
  return readFileSync(resolve(filePath), 'utf8').split(/\r?\n/).filter(Boolean)
    .map(line => normalizeTepRow(JSON.parse(line)));
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}
function median(values) { return quantile(values, 0.5); }
function standardDeviation(values, average = mean(values)) {
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function channelStats(rows, channelNames, minimumScaleRatio) {
  return Object.fromEntries(channelNames.map(channel => {
    const values = rows.map(row => row.channels[channel]).filter(finite);
    if (values.length !== rows.length) throw new Error(`Missing TEP channel: ${channel}`);
    const average = mean(values);
    const center = median(values);
    const mad = median(values.map(value => Math.abs(value - center)));
    const iqrScale = (quantile(values, 0.75) - quantile(values, 0.25)) / 1.349;
    const robustScale = Math.max(1.4826 * mad, iqrScale);
    const minimumScale = Math.max(1e-6, Math.abs(center) * minimumScaleRatio);
    const scale = Math.max(robustScale, minimumScale);
    return [channel, {
      channel, mean: average, median: center, std: standardDeviation(values, average),
      robustScale, minimumScale, scale, scaleFloorApplied: scale > robustScale
    }];
  }));
}

function channelNamesFrom(rows) {
  const names = Object.keys(rows[0]?.channels ?? {}).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  if (!names.length) throw new Error('TEP rows contain no channels');
  if (rows.some(row => names.some(name => !Object.hasOwn(row.channels, name))))
    throw new Error('TEP rows do not share the same channel schema');
  return names;
}

function fitBaseline(rows, { scope, normalQuantile = 0.99, minimumScaleRatio = 1e-4 } = {}) {
  if (!rows.length) throw new Error('At least one TEP row is required');
  const channelNames = channelNamesFrom(rows);
  const stats = channelStats(rows, channelNames, minimumScaleRatio);
  const model = { schemaVersion: 1, method: 'tep-robust-max-z-v1', scope,
    channelNames, stats, normalQuantile, minimumScaleRatio };
  const scores = rows.map(row => scoreAgainstBaseline(row, model).score);
  return { ...model, threshold: quantile(scores, normalQuantile), trainingRows: rows.length };
}

export function splitTepRowsByTime(rows, { trainFraction = 0.8 } = {}) {
  if (!Array.isArray(rows) || rows.length < 10) throw new Error('At least ten TEP rows are required');
  if (!finite(trainFraction) || trainFraction <= 0.5 || trainFraction >= 1) throw new Error('Invalid trainFraction');
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.processModeId}:${row.runId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const train = [], holdout = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.timeSeconds - b.timeSeconds);
    const cut = Math.floor(group.length * trainFraction);
    if (cut < 2 || cut >= group.length) throw new Error('TEP split leaves too few rows');
    train.push(...group.slice(0, cut));
    holdout.push(...group.slice(cut));
  }
  return { train, holdout, policy: 'time-ordered within processModeId/runId' };
}

export function fitTepModeBaseline(rows, options = {}) {
  const normal = rows.filter(row => row.scenarioType === 'normal');
  if (normal.length < 10) throw new Error('At least ten normal TEP rows are required');
  const split = splitTepRowsByTime(normal, options);
  const byMode = new Map();
  split.train.forEach(row => {
    if (!byMode.has(row.processModeId)) byMode.set(row.processModeId, []);
    byMode.get(row.processModeId).push(row);
  });
  const modes = Object.fromEntries([...byMode.entries()].map(([mode, modeRows]) =>
    [mode, fitBaseline(modeRows, { ...options, scope: mode })]));
  return { schemaVersion: 1, method: 'tep-mode-aware-robust-max-z-v1', scope: 'mode', modes,
    split: { trainRows: split.train.length, holdoutRows: split.holdout.length, policy: split.policy },
    holdoutRows: split.holdout };
}

export function fitTepGlobalBaseline(rows, options = {}) {
  const normal = rows.filter(row => row.scenarioType === 'normal');
  if (normal.length < 10) throw new Error('At least ten normal TEP rows are required');
  const split = splitTepRowsByTime(normal, options);
  return { schemaVersion: 1, method: 'tep-global-robust-max-z-v1', scope: 'global',
    global: fitBaseline(split.train, { ...options, scope: 'GLOBAL' }),
    split: { trainRows: split.train.length, holdoutRows: split.holdout.length, policy: split.policy },
    holdoutRows: split.holdout };
}

export function scoreTepRow(row, model) {
  const normalized = normalizeTepRow(row);
  const active = model.scope === 'mode' ? model.modes?.[normalized.processModeId] : model.global;
  if (!active) return { modeKnown: false, processModeId: normalized.processModeId,
    state: 'INSUFFICIENT_EVIDENCE', score: null, threshold: null, topFeatures: [] };
  return scoreAgainstBaseline(normalized, active);
}

function temporalOptions({ persistenceRows = 3, transitionGraceRows = 2 } = {}) {
  if (!Number.isInteger(persistenceRows) || persistenceRows < 1)
    throw new Error('Invalid persistenceRows');
  if (!Number.isInteger(transitionGraceRows) || transitionGraceRows < 0)
    throw new Error('Invalid transitionGraceRows');
  return { persistenceRows, transitionGraceRows };
}

export function scoreTepSeries(rows, model, options = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('At least one TEP row is required');
  const { persistenceRows, transitionGraceRows } = temporalOptions(options);
  const normalized = rows.map(normalizeTepRow);
  const runs = new Map();
  const results = [];
  normalized.forEach((row, index) => {
    const previous = runs.get(row.runId) ?? {
      lastTimeSeconds: null, lastMode: null, anomalyStreak: 0, transitionRemaining: 0
    };
    if (previous.lastTimeSeconds !== null && row.timeSeconds < previous.lastTimeSeconds)
      throw new Error('TEP series must be time-ordered within each run');

    const raw = scoreTepRow(row, model);
    const modeChanged = previous.lastMode !== null && previous.lastMode !== row.processModeId;
    let state;
    if (!raw.modeKnown) {
      state = 'INSUFFICIENT_EVIDENCE';
      previous.anomalyStreak = 0;
      previous.transitionRemaining = 0;
    } else if (modeChanged && transitionGraceRows > 0) {
      state = 'MODE_TRANSITION';
      previous.anomalyStreak = 0;
      previous.transitionRemaining = transitionGraceRows;
    } else if (previous.transitionRemaining > 0) {
      state = 'MODE_TRANSITION';
      previous.transitionRemaining--;
      previous.anomalyStreak = 0;
    } else if (raw.state === 'ANOMALY') {
      previous.anomalyStreak++;
      state = previous.anomalyStreak >= persistenceRows ? 'ANOMALY' : 'PENDING_ANOMALY';
    } else {
      previous.anomalyStreak = 0;
      state = 'NORMAL';
    }
    previous.lastTimeSeconds = row.timeSeconds;
    previous.lastMode = row.processModeId;
    runs.set(row.runId, previous);
    results.push({ row, index, result: {
      ...raw, rawState: raw.state, state,
      consecutiveExceedances: previous.anomalyStreak,
      modeTransition: modeChanged || state === 'MODE_TRANSITION'
    } });
  });
  return results;
}

export function evaluateTepSeries(rows, model, options = {}) {
  const { persistenceRows, transitionGraceRows } = temporalOptions(options);
  const results = scoreTepSeries(rows, model, { persistenceRows, transitionGraceRows });
  const byMode = new Map();
  const previousAlarmByRun = new Map();
  let alarmEpisodes = 0;
  results.forEach(({ row, result }) => {
    if (!byMode.has(row.processModeId)) byMode.set(row.processModeId, {
      rows: 0, evaluableRows: 0, anomalyRows: 0, pendingRows: 0,
      modeTransitionRows: 0, unknownMode: 0
    });
    const summary = byMode.get(row.processModeId);
    summary.rows++;
    if (!result.modeKnown) summary.unknownMode++;
    else if (result.state === 'MODE_TRANSITION') summary.modeTransitionRows++;
    else {
      summary.evaluableRows++;
      if (result.state === 'ANOMALY') summary.anomalyRows++;
      if (result.state === 'PENDING_ANOMALY') summary.pendingRows++;
    }
    const previousAlarm = previousAlarmByRun.get(row.runId) ?? false;
    const currentAlarm = result.state === 'ANOMALY';
    if (currentAlarm && !previousAlarm) alarmEpisodes++;
    previousAlarmByRun.set(row.runId, currentAlarm);
  });
  const modeSummary = Object.fromEntries([...byMode.entries()].map(([mode, value]) => [mode, {
    ...value, falseAlarmRate: value.evaluableRows ? value.anomalyRows / value.evaluableRows : null
  }]));
  const evaluable = results.filter(({ result }) => result.modeKnown && result.state !== 'MODE_TRANSITION');
  const anomalyRows = evaluable.filter(({ result }) => result.state === 'ANOMALY').length;
  return {
    rows: results.length, evaluableRows: evaluable.length, anomalyRows,
    pendingRows: results.filter(({ result }) => result.state === 'PENDING_ANOMALY').length,
    modeTransitionRows: results.filter(({ result }) => result.state === 'MODE_TRANSITION').length,
    unknownMode: results.filter(({ result }) => !result.modeKnown).length,
    falseAlarmRate: evaluable.length ? anomalyRows / evaluable.length : null,
    alarmEpisodes, persistenceRows, transitionGraceRows, byMode: modeSummary
  };
}

function scoreAgainstBaseline(normalized, active) {
  const contributions = active.channelNames.map(channel => {
    const stat = active.stats[channel];
    const zScore = Math.abs((normalized.channels[channel] - stat.median) / stat.scale);
    return { channel, zScore, value: normalized.channels[channel], center: stat.median, scale: stat.scale };
  }).sort((a, b) => b.zScore - a.zScore);
  const score = contributions[0]?.zScore ?? 0;
  return { modeKnown: true, processModeId: normalized.processModeId,
    state: score > active.threshold ? 'ANOMALY' : 'NORMAL', score, threshold: active.threshold,
    topFeatures: contributions.slice(0, 5) };
}

export function evaluateTepRows(rows, model) {
  const results = rows.map(row => ({ row, result: scoreTepRow(row, model) }));
  const byMode = new Map();
  results.forEach(({ row, result }) => {
    if (!byMode.has(row.processModeId)) byMode.set(row.processModeId, { rows: 0, falseAlarms: 0, unknownMode: 0 });
    const summary = byMode.get(row.processModeId);
    summary.rows++;
    if (!result.modeKnown) summary.unknownMode++;
    else if (result.state === 'ANOMALY') summary.falseAlarms++;
  });
  const summary = Object.fromEntries([...byMode.entries()].map(([mode, value]) => [mode, {
    ...value, falseAlarmRate: value.rows ? value.falseAlarms / value.rows : null
  }]));
  const known = results.filter(item => item.result.modeKnown);
  const falseAlarms = known.filter(item => item.result.state === 'ANOMALY').length;
  return { rows: results.length, falseAlarms, falseAlarmRate: known.length ? falseAlarms / known.length : null,
    unknownMode: results.length - known.length, byMode: summary };
}

export function compareTepBaselines(rows, options = {}) {
  const modeModel = fitTepModeBaseline(rows, options);
  const globalModel = fitTepGlobalBaseline(rows, options);
  const temporal = { persistenceRows: 3, transitionGraceRows: 2 };
  return {
    modeAware: {
      model: modeModel,
      evaluation: evaluateTepRows(modeModel.holdoutRows, modeModel),
      temporal: evaluateTepSeries(modeModel.holdoutRows, modeModel, temporal)
    },
    global: {
      model: globalModel,
      evaluation: evaluateTepRows(globalModel.holdoutRows, globalModel),
      temporal: evaluateTepSeries(globalModel.holdoutRows, globalModel, temporal)
    },
    comparisonDecision: {
      status: 'inconclusive',
      reason: 'normal_holdout_only_no_fault_recall_or_detection_lead_time',
      nextEvidence: ['independent normal runs', 'fault scenarios with onset labels', 'mode transition cases']
    },
    limitations: [
      'Tennessee Eastman은 화학공정 시뮬레이션이며 반도체 FAB 데이터가 아닙니다.',
      '현재 선택 범위는 모드별 정상 trajectory 하나이므로 독립 run 일반화 증거가 아닙니다.',
      '정상 holdout은 시간 후반부이며 fault 성능 평가는 아직 포함하지 않았습니다.',
      'persistence와 모드 전환 보류는 운영 판단 규칙의 검증이지 fault 탐지 성능의 증거가 아닙니다.'
    ]
  };
}
