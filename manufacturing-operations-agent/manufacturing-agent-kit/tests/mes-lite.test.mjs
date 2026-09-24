import test from 'node:test';
import assert from 'node:assert/strict';
import { attachMesContext, createTepBenchmarkMesContext, createVirtualMesContext, normalizeMesContext, transitionMesState } from '../src/mes-lite.mjs';
import { generateScenario, trainDemoModel, runScenario } from '../src/agent-harness.mjs';

test('virtual MES context validates work, lot, operation, equipment and mode', () => {
  const context = createVirtualMesContext();
  assert.equal(context.workOrderId, 'WO-DEMO-001');
  assert.equal(context.operationMode, 'AUTO');
  assert.equal(context.executionState, 'RUN');
  assert.equal(context.source, 'virtual-mes');
});

test('MES context attaches only to the matching event', () => {
  const model = trainDemoModel();
  const event = runScenario('temperature_rise', model);
  const attached = attachMesContext(event, createVirtualMesContext({ runId: event.runId }));
  assert.equal(attached.mesContext.equipmentId, event.equipmentId);
  assert.equal(attached.mesContext.runId, event.runId);
  assert.throws(() => attachMesContext(event, createVirtualMesContext({ runId: 'other-run' })), /MES run/);
});

test('MES execution state uses an explicit transition boundary', () => {
  const context = createVirtualMesContext({ executionState: 'IDLE' });
  assert.equal(transitionMesState(context, 'RUN').executionState, 'RUN');
  assert.throws(() => transitionMesState(context, 'COMPLETE'), /Invalid MES transition/);
  assert.throws(() => normalizeMesContext({ ...context, operationMode: 'UNKNOWN' }), /operationMode/);
  assert.equal(generateScenario('normal').length, 10);
});

test('TEP benchmark receives simulation-only MES context without becoming FAB data', () => {
  const context = createTepBenchmarkMesContext({ processModeId: 'MODE_1', runId: 'tep-mode-1' });
  assert.equal(context.source, 'virtual-mes-benchmark');
  assert.equal(context.operationMode, 'SIMULATE');
  assert.equal(context.processModeId, 'MODE_1');
  assert.equal(context.equipmentId, 'tep-simulation-equipment');
});
