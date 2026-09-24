import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FEATURE_NAMES = [
  'temperature_current_c', 'temperature_mean_c', 'temperature_slope_c_per_min',
  'temperature_range_c', 'distance_mean_cm', 'distance_std_cm',
  'distance_delta_cm', 'motion_mismatch', 'ambient_delta_c',
  'ultrasonic_frequency_hz', 'ultrasonic_echo_quality',
  'camera_distance_mean_cm', 'camera_person_ratio',
  'camera_ultrasonic_disagreement_cm', 'servo_motion_mismatch',
  'sensor_degraded_ratio'
];

// These are conservative measurement floors for the current demo sensors.
// They must be replaced or calibrated from sensor resolution/repeatability
// before interpreting a field deployment as a validated model.
export const DEFAULT_MINIMUM_SCALES = Object.freeze({
  temperature_current_c: 0.1,
  temperature_mean_c: 0.1,
  temperature_slope_c_per_min: 1.0,
  temperature_range_c: 0.1,
  distance_mean_cm: 0.2,
  distance_std_cm: 0.05,
  distance_delta_cm: 0.2,
  motion_mismatch: 0.1,
  ambient_delta_c: 0.1,
  ultrasonic_frequency_hz: 50,
  ultrasonic_echo_quality: 0.02,
  camera_distance_mean_cm: 5,
  camera_person_ratio: 0.1,
  camera_ultrasonic_disagreement_cm: 5,
  servo_motion_mismatch: 0.1,
  sensor_degraded_ratio: 0.1
});

export const DEFAULT_SAFETY = Object.freeze({
  temperatureHighC: 45,
  temperatureRiseCPerMin: 8,
  warningDistanceCm: 80,
  emergencyDistanceCm: 40
});

export const DEFAULT_SOP_INDEX = Object.freeze([
  { id: 'sop-temperature-001', title: '온도 상승 점검 절차', terms: ['온도', '발열', '과열'],
    steps: ['열원과 통풍 상태를 확인한다', '모터 정지 상태를 확인한다', '센서 배선과 값 고정을 확인한다', '30초 이상 냉각 추세를 재측정한다'] },
  { id: 'sop-motion-001', title: '구동·거리 불일치 점검 절차', terms: ['거리', '동작', '모터', '구속'],
    steps: ['모터 명령과 실제 움직임을 비교한다', '초음파 표적판 위치와 배선을 확인한다', '이물질 또는 기계적 구속 여부를 확인한다'] },
  { id: 'sop-person-001', title: '작업자 접근 안전 절차', terms: ['사람', '접근', '위험', '비상'],
    steps: ['경고음과 빨간 LED 상태를 확인한다', '위험 구역 접근을 중지한다', '비상 정지 후 작업자 안전을 확인한다', '수동 승인 전 재가동하지 않는다'] }
]);

const finite = value => typeof value === 'number' && Number.isFinite(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const HEALTH_STATES = ['OK', 'DEGRADED', 'FAIL'];
const LED_COLORS = ['OFF', 'BLUE', 'ORANGE', 'RED'];
const BUZZER_STATES = ['OFF', 'PERIODIC', 'CONTINUOUS'];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function normalizeObservation(input) {
  if (!input || typeof input !== 'object') throw new Error('Observation must be an object');
  const aggregateHealth = input.sensorHealth ?? 'OK';
  const cameraPersonDetected = input.cameraPersonDetected ?? input.personDetected ?? false;
  const cameraDistanceCm = input.cameraDistanceCm ?? input.personDistanceCm ?? null;
  const observation = {
    schemaVersion: 1,
    timestamp: input.timestamp ?? new Date().toISOString(),
    equipmentId: input.equipmentId ?? 'demo-rig',
    runId: input.runId ?? input.scenarioId ?? 'run-unknown',
    temperatureC: input.temperatureC,
    ambientTemperatureC: input.ambientTemperatureC ?? null,
    ultrasonicDistanceCm: input.ultrasonicDistanceCm,
    ultrasonicFrequencyHz: input.ultrasonicFrequencyHz ?? null,
    ultrasonicEchoQuality: input.ultrasonicEchoQuality ?? null,
    motorCommand: input.motorCommand ?? 'STOP',
    motorMotionConfirmed: input.motorMotionConfirmed ?? null,
    servoCommand: input.servoCommand ?? null,
    servoMotionConfirmed: input.servoMotionConfirmed ?? null,
    servoPositionDeg: input.servoPositionDeg ?? null,
    cameraPersonDetected: Boolean(cameraPersonDetected),
    cameraDistanceCm,
    personDetected: Boolean(cameraPersonDetected),
    personDistanceCm: cameraDistanceCm,
    temperatureSensorHealth: input.temperatureSensorHealth ?? aggregateHealth,
    ultrasonicSensorHealth: input.ultrasonicSensorHealth ?? aggregateHealth,
    cameraHealth: input.cameraHealth ?? aggregateHealth,
    ledHealth: input.ledHealth ?? aggregateHealth,
    buzzerHealth: input.buzzerHealth ?? aggregateHealth,
    servoHealth: input.servoHealth ?? aggregateHealth,
    sensorHealth: aggregateHealth,
    ledColor: input.ledColor ?? null,
    buzzerState: input.buzzerState ?? null,
    scenarioId: input.scenarioId ?? 'unlabelled'
  };
  if (Number.isNaN(Date.parse(observation.timestamp))) throw new Error('Invalid timestamp');
  if (typeof observation.equipmentId !== 'string' || !observation.equipmentId)
    throw new Error('Invalid equipmentId');
  if (typeof observation.runId !== 'string' || !observation.runId) throw new Error('Invalid runId');
  if (!finite(observation.temperatureC) || observation.temperatureC < -50 || observation.temperatureC > 150)
    throw new Error('Invalid temperatureC');
  if (observation.ambientTemperatureC !== null &&
      (!finite(observation.ambientTemperatureC) || observation.ambientTemperatureC < -50 || observation.ambientTemperatureC > 150))
    throw new Error('Invalid ambientTemperatureC');
  if (!finite(observation.ultrasonicDistanceCm) || observation.ultrasonicDistanceCm < 0 || observation.ultrasonicDistanceCm > 500)
    throw new Error('Invalid ultrasonicDistanceCm');
  if (observation.ultrasonicFrequencyHz !== null &&
      (!finite(observation.ultrasonicFrequencyHz) || observation.ultrasonicFrequencyHz < 0 || observation.ultrasonicFrequencyHz > 500000))
    throw new Error('Invalid ultrasonicFrequencyHz');
  if (observation.ultrasonicEchoQuality !== null &&
      (!finite(observation.ultrasonicEchoQuality) || observation.ultrasonicEchoQuality < 0 || observation.ultrasonicEchoQuality > 1))
    throw new Error('Invalid ultrasonicEchoQuality');
  if (!['RUN', 'STOP'].includes(observation.motorCommand)) throw new Error('Invalid motorCommand');
  if (observation.motorMotionConfirmed !== null && typeof observation.motorMotionConfirmed !== 'boolean')
    throw new Error('Invalid motorMotionConfirmed');
  if (observation.servoCommand !== null && !['RUN', 'STOP'].includes(observation.servoCommand))
    throw new Error('Invalid servoCommand');
  if (observation.servoMotionConfirmed !== null && typeof observation.servoMotionConfirmed !== 'boolean')
    throw new Error('Invalid servoMotionConfirmed');
  if (observation.servoPositionDeg !== null &&
      (!finite(observation.servoPositionDeg) || observation.servoPositionDeg < 0 || observation.servoPositionDeg > 180))
    throw new Error('Invalid servoPositionDeg');
  if (observation.personDistanceCm !== null &&
      (!finite(observation.personDistanceCm) || observation.personDistanceCm < 0 || observation.personDistanceCm > 1000))
    throw new Error('Invalid personDistanceCm');
  if (!HEALTH_STATES.includes(observation.sensorHealth) ||
      !HEALTH_STATES.includes(observation.temperatureSensorHealth) ||
      !HEALTH_STATES.includes(observation.ultrasonicSensorHealth) ||
      !HEALTH_STATES.includes(observation.cameraHealth) ||
      !HEALTH_STATES.includes(observation.ledHealth) ||
      !HEALTH_STATES.includes(observation.buzzerHealth) ||
      !HEALTH_STATES.includes(observation.servoHealth))
    throw new Error('Invalid sensor health');
  if (observation.ledColor !== null && !LED_COLORS.includes(observation.ledColor))
    throw new Error('Invalid ledColor');
  if (observation.buzzerState !== null && !BUZZER_STATES.includes(observation.buzzerState))
    throw new Error('Invalid buzzerState');
  return observation;
}

export function createJsonlCollector(filePath) {
  const target = resolve(filePath);
  mkdirSync(dirname(target), { recursive: true });
  return {
    path: target,
    append(input) {
      const observation = normalizeObservation(input);
      appendFileSync(target, JSON.stringify(observation) + '\n', 'utf8');
      return observation;
    },
    appendMany(inputs) { return inputs.map(input => this.append(input)); },
    read() {
      return readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean)
        .map(line => normalizeObservation(JSON.parse(line)));
    }
  };
}

export function chunkObservations(observations, size = 10) {
  if (!Number.isInteger(size) || size < 2) throw new Error('Window size must be at least 2');
  const normalized = observations.map(normalizeObservation);
  const chunks = [];
  for (let i = 0; i + size <= normalized.length; i += size) chunks.push(normalized.slice(i, i + size));
  return chunks;
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function std(values, average = mean(values)) {
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}
function median(values) { return quantile(values, 0.5); }

export function buildFeatureVector(window) {
  const rows = window.map(normalizeObservation);
  if (rows.length < 2) throw new Error('A feature window needs at least two observations');
  const temperatures = rows.map(row => row.temperatureC);
  const distances = rows.map(row => row.ultrasonicDistanceCm);
  const firstTime = Date.parse(rows[0].timestamp);
  const lastTime = Date.parse(rows.at(-1).timestamp);
  const minutes = Math.max((lastTime - firstTime) / 60000, 1 / 60);
  const temperatureMean = mean(temperatures);
  const distanceMean = mean(distances);
  const motionMismatch = rows.filter(row => row.motorCommand === 'RUN' && row.motorMotionConfirmed === false).length / rows.length;
  const servoRows = rows.filter(row => row.servoCommand !== null);
  const servoMismatch = servoRows.length
    ? servoRows.filter(row => row.servoCommand === 'RUN' && row.servoMotionConfirmed === false).length / servoRows.length
    : 0;
  const ultrasonicFrequencies = rows.filter(row => row.ultrasonicFrequencyHz !== null).map(row => row.ultrasonicFrequencyHz);
  const echoQualities = rows.filter(row => row.ultrasonicEchoQuality !== null).map(row => row.ultrasonicEchoQuality);
  const cameraDistances = rows.filter(row => row.cameraDistanceCm !== null).map(row => row.cameraDistanceCm);
  const cameraDisagreements = rows
    .filter(row => row.cameraDistanceCm !== null)
    .map(row => Math.abs(row.cameraDistanceCm - row.ultrasonicDistanceCm));
  const healthStatuses = rows.flatMap(row => [
    row.temperatureSensorHealth, row.ultrasonicSensorHealth, row.cameraHealth,
    row.ledHealth, row.buzzerHealth, row.servoHealth
  ]);
  const ambientRows = rows.filter(row => row.ambientTemperatureC !== null);
  return {
    temperature_current_c: temperatures.at(-1),
    temperature_mean_c: temperatureMean,
    temperature_slope_c_per_min: (temperatures.at(-1) - temperatures[0]) / minutes,
    temperature_range_c: Math.max(...temperatures) - Math.min(...temperatures),
    distance_mean_cm: distanceMean,
    distance_std_cm: std(distances, distanceMean),
    distance_delta_cm: distances.at(-1) - distances[0],
    motion_mismatch: motionMismatch,
    ambient_delta_c: ambientRows.length ? temperatures.at(-1) - mean(ambientRows.map(row => row.ambientTemperatureC)) : 0,
    ultrasonic_frequency_hz: ultrasonicFrequencies.length ? mean(ultrasonicFrequencies) : 0,
    ultrasonic_echo_quality: echoQualities.length ? mean(echoQualities) : 0,
    camera_distance_mean_cm: cameraDistances.length ? mean(cameraDistances) : 0,
    camera_person_ratio: rows.filter(row => row.cameraPersonDetected).length / rows.length,
    camera_ultrasonic_disagreement_cm: cameraDisagreements.length ? mean(cameraDisagreements) : 0,
    servo_motion_mismatch: servoMismatch,
    sensor_degraded_ratio: healthStatuses.filter(status => status !== 'OK').length / healthStatuses.length
  };
}

export function quantile(values, q) {
  if (!values.length || q < 0 || q > 1) throw new Error('Invalid quantile input');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export function fitNormalModel(normalWindows, {
  normalQuantile = 0.95,
  version = 'edge-feature-normal-reference-v2',
  minimumScales = DEFAULT_MINIMUM_SCALES
} = {}) {
  if (!Array.isArray(normalWindows) || normalWindows.length < 3) throw new Error('At least three normal windows are required');
  const vectors = normalWindows.map(buildFeatureVector);
  const stats = FEATURE_NAMES.map(feature => {
    const values = vectors.map(vector => vector[feature]);
    const average = mean(values);
    const center = median(values);
    const standardDeviation = std(values, average);
    const q1 = quantile(values, 0.25), q3 = quantile(values, 0.75);
    const mad = median(values.map(value => Math.abs(value - center)));
    const robustScale = Math.max(1.4826 * mad, (q3 - q1) / 1.349);
    const minimumScale = minimumScales?.[feature];
    if (!finite(minimumScale) || minimumScale <= 0) throw new Error(`Invalid minimum scale for ${feature}`);
    const scale = Math.max(robustScale, minimumScale);
    return {
      feature, mean: average, median: center, std: standardDeviation,
      mad, robustScale, minimumScale, scale,
      scaleFloorApplied: scale > robustScale,
      degenerate: standardDeviation < minimumScale
    };
  });
  const scoreVector = vector => Math.max(...stats.map(({ feature, median: center, mean: average, scale }) =>
    Math.abs((vector[feature] - (Number.isFinite(center) ? center : average)) / scale)));
  const normalScores = vectors.map(scoreVector);
  return {
    schemaVersion: 1,
    version,
    method: 'normal-reference-max-abs-z',
    scaling: 'median-mad-iqr-with-sensor-floor-v1',
    featureNames: FEATURE_NAMES,
    stats,
    minimumScales,
    degenerateFeatures: stats.filter(stat => stat.degenerate).map(stat => stat.feature),
    threshold: quantile(normalScores, normalQuantile),
    normalQuantile,
    trainingWindows: normalWindows.length
  };
}

export function auditNormalWindows(windows, { iqrMultiplier = 1.5 } = {}) {
  if (!Array.isArray(windows) || !windows.length) throw new Error('At least one window is required');
  if (!finite(iqrMultiplier) || iqrMultiplier <= 0) throw new Error('Invalid iqrMultiplier');
  const vectors = windows.map(buildFeatureVector);
  const features = FEATURE_NAMES.map(feature => {
    const values = vectors.map(vector => vector[feature]).sort((a, b) => a - b);
    const q1 = quantile(values, 0.25), q3 = quantile(values, 0.75);
    const iqr = q3 - q1;
    const lower = q1 - iqrMultiplier * iqr, upper = q3 + iqrMultiplier * iqr;
    const outlierIndexes = values.length < 4
      ? []
      : vectors.map((vector, index) => {
        const value = vector[feature];
        // With a degenerate IQR (e.g. seven identical baselines plus one
        // corrupted reading), values different from the baseline are still
        // useful data-quality candidates. This remains an audit flag, not a
        // machine-failure decision.
        const outlier = iqr === 0
          ? Math.abs(value - q1) > 1e-9
          : value < lower || value > upper;
        return outlier ? index : -1;
      }).filter(index => index >= 0);
    return { feature, min: values[0], max: values.at(-1), q1, q3, iqr, lower, upper,
      outlierCount: outlierIndexes.length, outlierIndexes };
  });
  return { windows: windows.length, features,
    candidateOutlierWindows: [...new Set(features.flatMap(feature => feature.outlierIndexes))].sort((a, b) => a - b),
    limitations: ['IQR 결과는 이상치 후보이며 실제 고장 판정이 아닙니다.', '정상 운전 조건이 충분히 다양하지 않으면 정상 변동도 후보로 표시될 수 있습니다.'] };
}

export function splitNormalWindowsByRun(windows, { holdoutFraction = 0.2 } = {}) {
  if (!Array.isArray(windows) || windows.length < 4) throw new Error('At least four windows are required for holdout');
  if (!finite(holdoutFraction) || holdoutFraction <= 0 || holdoutFraction >= 0.5) throw new Error('Invalid holdoutFraction');
  const groups = new Map();
  windows.forEach((window, index) => {
    const rows = window.map(normalizeObservation);
    const runId = rows[0].runId;
    if (rows.some(row => row.runId !== runId)) throw new Error('A window cannot mix run IDs');
    if (!groups.has(runId)) groups.set(runId, { runId, firstTimestamp: Date.parse(rows[0].timestamp), windows: [] });
    groups.get(runId).windows.push({ index, window: rows });
  });
  if (groups.size < 2) throw new Error('At least two independent run IDs are required for holdout');
  const ordered = [...groups.values()].sort((a, b) => a.firstTimestamp - b.firstTimestamp || a.runId.localeCompare(b.runId));
  const holdoutRuns = Math.max(1, Math.ceil(ordered.length * holdoutFraction));
  const trainGroups = ordered.slice(0, -holdoutRuns);
  const holdoutGroups = ordered.slice(-holdoutRuns);
  const train = trainGroups.flatMap(group => group.windows.map(item => item.window));
  const holdout = holdoutGroups.flatMap(group => group.windows.map(item => item.window));
  if (train.length < 3 || !holdout.length) throw new Error('Holdout leaves too few training windows');
  return { train, holdout, trainRunIds: trainGroups.map(group => group.runId), holdoutRunIds: holdoutGroups.map(group => group.runId) };
}

export function fitNormalModelWithHoldout(normalWindows, options = {}) {
  const split = splitNormalWindowsByRun(normalWindows, options);
  const model = fitNormalModel(split.train, options);
  const holdoutScores = split.holdout.map(window => scoreFeatureVector(buildFeatureVector(window), model));
  const falseAlarms = holdoutScores.filter(score => score > model.threshold).length;
  const audit = auditNormalWindows(split.train);
  const expectedFalseAlarmRate = 1 - model.normalQuantile;
  const holdoutFalseAlarmRate = falseAlarms / holdoutScores.length;
  return {
    ...model,
    // Keep the scoring method stable for existing consumers; the validation
    // protocol is reported separately below.
    method: model.method,
    trainingMode: 'run-holdout',
    splitPolicy: 'runId groups ordered by first timestamp; newest independent runs held out',
    holdout: {
      windows: split.holdout.length,
      trainWindows: split.train.length,
      trainRunIds: split.trainRunIds,
      holdoutRunIds: split.holdoutRunIds,
      scores: holdoutScores,
      falseAlarms,
      falseAlarmRate: holdoutFalseAlarmRate,
      expectedFalseAlarmRate,
      status: split.holdout.length < 5 ? 'small_sample' : 'measured',
      overfitWarning: holdoutFalseAlarmRate > expectedFalseAlarmRate + 0.10
    },
    dataAudit: audit
  };
}

export function scoreFeatureVector(vector, model) {
  if (!model || !['normal-reference-max-abs-z', 'normal-reference-max-abs-z-with-run-holdout'].includes(model.method))
    throw new Error('Unsupported anomaly model');
  return Math.max(...model.stats.map(({ feature, mean: average, median: center, std, scale }) => {
    const location = Number.isFinite(center) ? center : average;
    const spread = Number.isFinite(scale) ? scale : Math.max(std, 1e-6);
    return Math.abs((vector[feature] - location) / spread);
  }));
}

function evidenceFor(vector, score, model, safety) {
  const evidence = [];
  if (vector.temperature_current_c >= safety.temperatureHighC)
    evidence.push(`온도 ${vector.temperature_current_c.toFixed(1)}°C가 보호 상한 ${safety.temperatureHighC}°C 이상입니다.`);
  if (vector.temperature_slope_c_per_min >= safety.temperatureRiseCPerMin)
    evidence.push(`온도 상승 속도 ${vector.temperature_slope_c_per_min.toFixed(2)}°C/분이 기준 ${safety.temperatureRiseCPerMin}°C/분 이상입니다.`);
  if (vector.motion_mismatch > 0)
    evidence.push(`모터 동작 명령 중 ${Math.round(vector.motion_mismatch * 100)}% 구간에서 거리 변화가 확인되지 않았습니다.`);
  if (vector.servo_motion_mismatch > 0)
    evidence.push(`서보 동작 명령 중 ${Math.round(vector.servo_motion_mismatch * 100)}% 구간에서 위치 변화가 확인되지 않았습니다.`);
  if (vector.ultrasonic_echo_quality > 0 && vector.ultrasonic_echo_quality < 0.5)
    evidence.push(`초음파 에코 품질 ${vector.ultrasonic_echo_quality.toFixed(2)}가 낮아 거리 측정 신뢰도가 저하되었습니다.`);
  if (vector.camera_ultrasonic_disagreement_cm >= 20)
    evidence.push(`카메라와 초음파 거리 차이 평균 ${vector.camera_ultrasonic_disagreement_cm.toFixed(1)}cm가 큽니다.`);
  if (vector.sensor_degraded_ratio > 0)
    evidence.push(`수집 구간의 ${Math.round(vector.sensor_degraded_ratio * 100)}%에서 센서 채널이 DEGRADED/FAIL 상태였습니다.`);
  if (score > model.threshold)
    evidence.push(`정상 기준 대비 이상 점수 ${score.toFixed(2)}가 임계값 ${model.threshold.toFixed(2)}를 초과했습니다.`);
  return evidence;
}

export function inspectWindow(window, model, options = {}) {
  const safety = { ...DEFAULT_SAFETY, ...options };
  const rows = window.map(normalizeObservation);
  const vector = buildFeatureVector(rows);
  const score = scoreFeatureVector(vector, model);
  const latest = rows.at(-1);
  const channelHealth = {
    temperature: latest.temperatureSensorHealth,
    ultrasonic: latest.ultrasonicSensorHealth,
    camera: latest.cameraHealth,
    led: latest.ledHealth,
    buzzer: latest.buzzerHealth,
    servo: latest.servoHealth
  };
  const failedChannels = Object.entries(channelHealth).filter(([, health]) => health === 'FAIL').map(([name]) => name);
  const degradedChannels = Object.entries(channelHealth).filter(([, health]) => health === 'DEGRADED').map(([name]) => name);
  const sensorFault = latest.sensorHealth === 'FAIL' || failedChannels.length > 0;
  const sensorDegraded = latest.sensorHealth === 'DEGRADED' || degradedChannels.length > 0;
  const personDistance = latest.personDetected ? latest.personDistanceCm : null;
  const emergency = personDistance !== null && personDistance <= safety.emergencyDistanceCm;
  const warning = personDistance !== null && personDistance <= safety.warningDistanceCm;
  const thermalRule = vector.temperature_current_c >= safety.temperatureHighC ||
    vector.temperature_slope_c_per_min >= safety.temperatureRiseCPerMin;
  const anomaly = sensorFault || sensorDegraded || thermalRule || vector.motion_mismatch > 0 ||
    vector.servo_motion_mismatch > 0 || vector.ultrasonic_echo_quality > 0 && vector.ultrasonic_echo_quality < 0.5 ||
    score > model.threshold;
  const state = emergency ? 'EMERGENCY' : warning ? 'WARNING' : anomaly ? 'ANOMALY' : 'NORMAL';
  const severity = state === 'EMERGENCY' ? 'critical' : state === 'ANOMALY' ? 'warning' : state === 'WARNING' ? 'caution' : 'normal';
  const actuator = state === 'EMERGENCY'
    ? { led: 'RED', buzzer: 'CONTINUOUS', servo: 'STOP' }
    : state === 'WARNING'
      ? { led: 'RED', buzzer: 'PERIODIC', servo: 'RUN' }
      : state === 'ANOMALY'
        ? { led: 'ORANGE', buzzer: 'OFF', servo: 'STOP' }
        : { led: 'BLUE', buzzer: 'OFF', servo: 'RUN' };
  const evidence = evidenceFor(vector, score, model, safety);
  if (failedChannels.length) evidence.push(`센서 채널 FAIL: ${failedChannels.join(', ')}. 측정값만으로 원인을 확정할 수 없습니다.`);
  if (degradedChannels.length) evidence.push(`센서 채널 DEGRADED: ${degradedChannels.join(', ')}. 측정 신뢰도를 확인해야 합니다.`);
  if (warning) evidence.push(`사람이 설비에서 ${personDistance?.toFixed(1)}cm 거리로 감지되었습니다.`);
  if (emergency) evidence.push(`사람이 최소 위험 거리 ${safety.emergencyDistanceCm}cm 이내에 있습니다.`);
  const modelLimitations = model.degenerateFeatures?.length
    ? [`정상 기준 변동이 부족한 특징이 있어 센서 최소 변동폭으로 보정했습니다: ${model.degenerateFeatures.join(', ')}`]
    : [];
  const event = {
    schemaVersion: 1,
    eventId: `live_${sha256(canonical({ equipmentId: latest.equipmentId, runId: latest.runId, observedAt: latest.timestamp, scenarioId: latest.scenarioId }))}`,
    equipmentId: latest.equipmentId,
    runId: latest.runId,
    observedAt: latest.timestamp,
    windowStart: rows[0].timestamp,
    windowEnd: latest.timestamp,
    scenarioId: latest.scenarioId,
    state, severity, anomalyScore: score, threshold: model.threshold,
    features: vector, evidence, actuator,
    feedback: {
      ledColor: latest.ledColor,
      buzzerState: latest.buzzerState,
      servoCommand: latest.servoCommand,
      servoMotionConfirmed: latest.servoMotionConfirmed,
      channelHealth
    },
    limitations: [
      '이상 점수는 고장 확률이 아니며 원인을 확정하지 않습니다.',
      '안전 정지는 LLM이 아닌 Python FSM이 결정합니다.',
      ...modelLimitations
    ]
  };
  return { ...event, agentPlan: runMaintenanceAgent(event) };
}

export function buildAgentPlan(event) {
  const observations = event.evidence.length ? event.evidence : ['정상 운전 기준과 유사한 센서 패턴입니다.'];
  if (event.state === 'NORMAL') return {
    status: 'ok', observations, hypotheses: [], recommendedChecks: [],
    requiresHumanConfirmation: false, nextTool: 'continue_monitoring'
  };
  if (event.state === 'WARNING') return {
    status: 'insufficient_evidence', observations,
    hypotheses: ['작업자 접근으로 안전 경고가 발생했습니다. 설비 고장 여부는 판단하지 않습니다.'],
    recommendedChecks: ['작업자가 경고 거리 밖으로 이동했는지 확인', '위험 구역 진입 시 모터 정지 상태 확인'],
    requiresHumanConfirmation: true, nextTool: 'request_operator_confirmation'
  };
  if (event.state === 'EMERGENCY') return {
    status: 'insufficient_evidence', observations,
    hypotheses: ['작업자가 최소 위험 거리 안으로 접근했습니다.'],
    recommendedChecks: ['현장 접근을 중지하고 비상 정지 상태를 확인', '작업자 안전 확보 후 재가동 여부를 수동 승인'],
    requiresHumanConfirmation: true, nextTool: 'request_operator_confirmation'
  };
  return {
    status: 'insufficient_evidence', observations,
    hypotheses: ['정상 운전 패턴과 다른 발열 또는 동작 패턴이 관찰되었습니다.', '가능한 원인은 과열, 통풍 저하, 구동부 구속 또는 센서 오류입니다.'],
    recommendedChecks: ['모터와 주변의 열원·통풍 상태 확인', '모터 정지 및 초음파 표적판의 위치 확인', '센서 배선과 측정값 고정 여부 확인', '조치 후 30초 이상 센서 추세 재확인'],
    requiresHumanConfirmation: true, nextTool: 'search_sop'
  };
}

export function searchSop(query, sopIndex = DEFAULT_SOP_INDEX) {
  const terms = Array.isArray(query) ? query : String(query).split(/\s+/).filter(Boolean);
  return sopIndex.filter(sop => sop.terms.some(term => terms.some(queryTerm =>
    term.includes(queryTerm) || queryTerm.includes(term))));
}

export function runMaintenanceAgent(event, { sopIndex = DEFAULT_SOP_INDEX } = {}) {
  const plan = buildAgentPlan(event);
  if (event.state === 'NORMAL') return { ...plan, toolTrace: [], evidenceRefs: [] };
  const query = event.state === 'WARNING' || event.state === 'EMERGENCY'
    ? ['사람', '접근', '위험']
    : event.evidence.join(' ');
  const matches = searchSop(query, sopIndex);
  const selected = matches[0] ?? null;
  const toolTrace = [{ tool: 'search_sop', input: { query }, resultCount: matches.length }];
  if (!selected) {
    return { ...plan, status: 'unavailable', toolTrace, evidenceRefs: [],
      limitations: ['승인된 SOP 근거가 없어 조치 방법을 확정하지 않습니다.'] };
  }
  return {
    ...plan,
    recommendedChecks: [...new Set([...plan.recommendedChecks, ...selected.steps])],
    toolTrace,
    evidenceRefs: [{ documentId: selected.id, title: selected.title, source: 'local-approved-sop-index' }]
  };
}

export function verifyRecovery(followupWindow, model, options = {}) {
  const followup = inspectWindow(followupWindow, model, options);
  const recovered = followup.state === 'NORMAL';
  return {
    recovered,
    state: followup.state,
    observedAt: followup.observedAt,
    evidence: followup.evidence,
    nextAction: recovered ? 'resume_only_after_operator_approval' : 'keep_stopped_and_escalate',
    followup
  };
}

function normalProfile(runId, index) {
  const phase = Number.parseInt(sha256(runId).slice(0, 8), 16) / 0xffffffff * Math.PI * 2;
  return {
    temperatureC: 28 + 0.18 * Math.sin(phase) + 0.06 * Math.sin(index / 2 + phase) + 0.02 * Math.cos(index + phase),
    ambientTemperatureC: 24 + 0.04 * Math.sin(phase / 2) + 0.01 * Math.sin(index / 3 + phase),
    ultrasonicDistanceCm: 30 + 0.35 * Math.sin(phase) + 0.12 * Math.sin(index / 2 + phase),
    ultrasonicFrequencyHz: 40000 + Math.round(35 * Math.sin(index / 3 + phase)),
    ultrasonicEchoQuality: 0.98 - 0.01 * Math.abs(Math.sin(index / 3 + phase))
  };
}

export function generateScenario(name, { points = 10, start = new Date('2026-09-14T14:00:00Z'), equipmentId = 'demo-rig', runId = `${name}-${start.toISOString()}` } = {}) {
  if (!['normal', 'temperature_rise', 'motion_fault', 'person_warning', 'person_emergency'].includes(name))
    throw new Error('Unknown scenario');
  return Array.from({ length: points }, (_, index) => {
    const timestamp = new Date(start.getTime() + index * 1000).toISOString();
    const normal = name === 'normal' ? normalProfile(runId, index) : null;
    const isPerson = name.startsWith('person_') && index >= Math.floor(points / 2);
    const personDistanceCm = !isPerson ? null : name === 'person_emergency' ? 25 : 60;
    const expectedActuator = name === 'person_emergency'
      ? { led: 'RED', buzzer: 'CONTINUOUS', servo: 'STOP' }
      : name === 'person_warning'
        ? { led: 'RED', buzzer: 'PERIODIC', servo: 'RUN' }
        : name === 'temperature_rise' || name === 'motion_fault'
          ? { led: 'ORANGE', buzzer: 'OFF', servo: 'STOP' }
          : { led: 'BLUE', buzzer: 'OFF', servo: 'RUN' };
    return normalizeObservation({
      timestamp, equipmentId, runId, scenarioId: name,
      // A gradual 0.15°C/s rise keeps the demo interpretable at its 1-second
      // sampling rate while crossing the explicit 8°C/min rule; it is still
      // synthetic and not a field thermal profile.
      temperatureC: name === 'temperature_rise' ? 28 + index * 0.15 : normal?.temperatureC ?? 28 + (index % 3) * 0.1,
      ambientTemperatureC: normal?.ambientTemperatureC ?? 24,
      ultrasonicDistanceCm: name === 'motion_fault' ? 30 : normal?.ultrasonicDistanceCm ?? 30 + (index % 2) * 0.4,
      ultrasonicFrequencyHz: normal?.ultrasonicFrequencyHz ?? 40000,
      ultrasonicEchoQuality: name === 'motion_fault' ? 0.45 : normal?.ultrasonicEchoQuality ?? 0.98,
      motorCommand: 'RUN',
      motorMotionConfirmed: name === 'motion_fault' ? false : true,
      servoCommand: expectedActuator.servo,
      servoMotionConfirmed: true,
      servoPositionDeg: expectedActuator.servo === 'RUN' ? 90 : 0,
      cameraPersonDetected: isPerson,
      cameraDistanceCm: personDistanceCm,
      personDetected: isPerson, personDistanceCm,
      ledColor: expectedActuator.led,
      buzzerState: expectedActuator.buzzer,
      sensorHealth: 'OK'
    });
  });
}

export function trainDemoModel() {
  const normal = Array.from({ length: 12 }, (_, i) => generateScenario('normal', {
    start: new Date(Date.parse('2026-09-14T13:00:00Z') + i * 60000)
  }));
  return fitNormalModelWithHoldout(normal, { normalQuantile: 0.95, holdoutFraction: 0.2 });
}

export function runScenario(name, model = trainDemoModel(), options = {}) {
  return inspectWindow(generateScenario(name, options), model, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const model = trainDemoModel();
  const scenarios = ['normal', 'temperature_rise', 'motion_fault', 'person_warning', 'person_emergency'];
  console.log(JSON.stringify({ model, results: scenarios.map(name => runScenario(name, model)) }, null, 2));
}
