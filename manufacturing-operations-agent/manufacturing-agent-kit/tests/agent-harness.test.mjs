import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditNormalWindows, buildFeatureVector, createJsonlCollector, fitNormalModel, fitNormalModelWithHoldout,
  generateScenario, inspectWindow, runScenario, trainDemoModel, verifyRecovery
} from '../src/agent-harness.mjs';

test('normal model keeps normal scenario blue and running', () => {
  const result = runScenario('normal');
  assert.equal(result.state, 'NORMAL');
  assert.deepEqual(result.actuator, { led: 'BLUE', buzzer: 'OFF', servo: 'RUN' });
  assert.equal(result.agentPlan.status, 'ok');
});

test('temperature rise creates evidence-grounded anomaly plan', () => {
  const result = runScenario('temperature_rise');
  assert.equal(result.state, 'ANOMALY');
  assert.deepEqual(result.actuator, { led: 'ORANGE', buzzer: 'OFF', servo: 'STOP' });
  assert.ok(result.evidence.some(item => item.includes('온도')));
  assert.equal(result.agentPlan.requiresHumanConfirmation, true);
  assert.match(result.agentPlan.hypotheses.join(' '), /원인은|가능한/);
  assert.equal(result.agentPlan.toolTrace[0].tool, 'search_sop');
  assert.equal(result.agentPlan.evidenceRefs[0].documentId, 'sop-temperature-001');
});

test('person proximity has priority over equipment anomaly state', () => {
  const warning = runScenario('person_warning');
  assert.equal(warning.state, 'WARNING');
  assert.deepEqual(warning.actuator, { led: 'RED', buzzer: 'PERIODIC', servo: 'RUN' });
  const emergency = runScenario('person_emergency');
  assert.equal(emergency.state, 'EMERGENCY');
  assert.deepEqual(emergency.actuator, { led: 'RED', buzzer: 'CONTINUOUS', servo: 'STOP' });
});

test('direct collection uses the same schema as live processing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-harness-'));
  try {
    const collector = createJsonlCollector(join(dir, 'observations.jsonl'));
    collector.append(generateScenario('normal', { points: 1 })[0]);
    const rows = collector.read();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].schemaVersion, 1);
    assert.equal(rows[0].scenarioId, 'normal');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('direct collection stores the full induced-heating trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-heating-'));
  try {
    const collector = createJsonlCollector(join(dir, 'temperature-rise.jsonl'));
    const input = generateScenario('temperature_rise', { points: 10 });
    collector.appendMany(input);
    const stored = collector.read();
    assert.equal(stored.length, 10);
    assert.equal(stored[0].scenarioId, 'temperature_rise');
    assert.ok(stored.at(-1).temperatureC > stored[0].temperatureC);
    assert.ok(stored.every(row => row.temperatureC >= 0 && row.sensorHealth === 'OK'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('model fitting requires normal windows and does not use anomaly labels', () => {
  const model = trainDemoModel();
  assert.equal(model.method, 'normal-reference-max-abs-z');
  assert.equal(model.featureNames.length, 16);
  assert.ok(model.threshold >= 0);
  const normal = generateScenario('normal');
  const temperature = generateScenario('temperature_rise');
  const anomaly = inspectWindow(temperature, model);
  assert.notEqual(anomaly.state, 'NORMAL');
  assert.equal(normal.length, temperature.length);
});

test('collection stores non-temperature sensor and actuator feedback without using outputs as features', () => {
  const normal = generateScenario('normal');
  const person = generateScenario('person_warning');
  const vector = buildFeatureVector(normal);
  const latest = person.at(-1);
  assert.equal(latest.ultrasonicFrequencyHz, 40000);
  assert.equal(latest.ultrasonicEchoQuality, 0.98);
  assert.equal(latest.cameraPersonDetected, true);
  assert.equal(latest.cameraDistanceCm, 60);
  assert.equal(latest.ledColor, 'RED');
  assert.equal(latest.buzzerState, 'PERIODIC');
  assert.equal(latest.servoCommand, 'RUN');
  assert.ok(vector.ultrasonic_frequency_hz >= 39950 && vector.ultrasonic_frequency_hz <= 40050);
  assert.equal(vector.servo_motion_mismatch, 0);
  assert.equal(vector.sensor_degraded_ratio, 0);
  assert.equal(Object.hasOwn(vector, 'ledColor'), false);
});

test('normal reference uses run variation and sensor-aware robust scaling', () => {
  const model = trainDemoModel();
  assert.equal(model.scaling, 'median-mad-iqr-with-sensor-floor-v1');
  assert.ok(model.threshold > 0);
  assert.ok(model.stats.some(stat => stat.scaleFloorApplied));
  assert.ok(model.degenerateFeatures.includes('camera_person_ratio'));
  const normal = runScenario('normal', model);
  const temperature = runScenario('temperature_rise', model);
  assert.ok(normal.anomalyScore <= model.threshold);
  assert.ok(temperature.anomalyScore > model.threshold);
  assert.ok(normal.limitations.some(item => item.includes('정상 기준 변동')));
});

test('a non-temperature channel failure becomes evidence-grounded anomaly', () => {
  const model = trainDemoModel();
  const faulty = generateScenario('normal').map(row => ({ ...row, ultrasonicSensorHealth: 'FAIL' }));
  const result = inspectWindow(faulty, model);
  assert.equal(result.state, 'ANOMALY');
  assert.ok(result.evidence.some(item => item.includes('ultrasonic')));
  assert.equal(result.feedback.channelHealth.ultrasonic, 'FAIL');
});

test('run holdout keeps the newest independent runs out of fitting and reports false alarms', () => {
  const windows = Array.from({ length: 10 }, (_, index) => generateScenario('normal', {
    start: new Date(Date.parse('2026-09-14T13:00:00Z') + index * 60000), runId: `normal-run-${index}`
  }));
  const model = fitNormalModelWithHoldout(windows, { holdoutFraction: 0.2 });
  assert.equal(model.method, 'normal-reference-max-abs-z');
  assert.equal(model.trainingMode, 'run-holdout');
  assert.equal(model.holdout.holdoutRunIds.length, 2);
  assert.equal(model.holdout.trainRunIds.includes('normal-run-8'), false);
  assert.equal(model.holdout.trainRunIds.includes('normal-run-9'), false);
  assert.equal(model.holdout.falseAlarmRate, 0);
  assert.equal(model.holdout.overfitWarning, false);
});

test('IQR audit marks a candidate data outlier without calling it a failure', () => {
  const windows = Array.from({ length: 8 }, (_, index) => generateScenario('normal', {
    start: new Date(Date.parse('2026-09-14T13:00:00Z') + index * 60000), runId: `audit-run-${index}`
  }));
  const corrupted = windows[7].map(row => ({ ...row, temperatureC: 100, runId: 'corrupt-run' }));
  const audit = auditNormalWindows([...windows.slice(0, 7), corrupted]);
  const temperatureAudit = audit.features.find(item => item.feature === 'temperature_current_c');
  assert.ok(temperatureAudit.outlierCount >= 1);
  assert.ok(audit.limitations.some(item => item.includes('고장')));
});

test('recovery verification keeps recheck separate from initial alarm', () => {
  const model = trainDemoModel();
  const recovery = verifyRecovery(generateScenario('normal'), model);
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.nextAction, 'resume_only_after_operator_approval');
});
