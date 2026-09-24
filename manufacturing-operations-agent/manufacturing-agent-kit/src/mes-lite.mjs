export const OPERATION_MODES = Object.freeze(['AUTO', 'SEMIAUTO', 'MANUAL', 'SIMULATE']);
export const EXECUTION_STATES = Object.freeze(['IDLE', 'RUN', 'PAUSED', 'COMPLETE', 'FAULT']);

const ISO_OR_NULL = value => value === null || value === undefined ||
  typeof value === 'string' && !Number.isNaN(Date.parse(value));
const requiredString = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`);
  return value.trim();
};

export function normalizeMesContext(input) {
  if (!input || typeof input !== 'object') throw new Error('MES context must be an object');
  const context = {
    schemaVersion: 1,
    source: input.source ?? 'virtual-mes',
    workOrderId: requiredString(input.workOrderId, 'workOrderId'),
    lotId: requiredString(input.lotId, 'lotId'),
    productId: requiredString(input.productId, 'productId'),
    recipeId: requiredString(input.recipeId, 'recipeId'),
    operationId: requiredString(input.operationId, 'operationId'),
    equipmentId: requiredString(input.equipmentId, 'equipmentId'),
    runId: requiredString(input.runId, 'runId'),
    processModeId: requiredString(input.processModeId ?? 'UNSPECIFIED', 'processModeId'),
    operationMode: input.operationMode ?? 'AUTO',
    executionState: input.executionState ?? 'RUN',
    plannedStartAt: input.plannedStartAt ?? null,
    actualStartAt: input.actualStartAt ?? null,
    operatorAck: input.operatorAck ?? false
  };
  if (!OPERATION_MODES.includes(context.operationMode)) throw new Error('Invalid operationMode');
  if (!EXECUTION_STATES.includes(context.executionState)) throw new Error('Invalid executionState');
  if (!ISO_OR_NULL(context.plannedStartAt) || !ISO_OR_NULL(context.actualStartAt))
    throw new Error('Invalid MES timestamp');
  if (typeof context.operatorAck !== 'boolean') throw new Error('Invalid operatorAck');
  return context;
}

export function createVirtualMesContext(overrides = {}) {
  return normalizeMesContext({
    source: 'virtual-mes',
    workOrderId: 'WO-DEMO-001',
    lotId: 'LOT-DEMO-001',
    productId: 'demo-product',
    recipeId: 'recipe-temperature-safety-v1',
    operationId: 'OP-HEAT-001',
    equipmentId: 'demo-rig',
    runId: 'temperature_rise-2026-09-14T14:00:00.000Z',
    processModeId: 'DEMO-AUTO',
    operationMode: 'AUTO',
    executionState: 'RUN',
    ...overrides
  });
}

export function createTepBenchmarkMesContext({ processModeId, runId,
  equipmentId = 'tep-simulation-equipment', ...overrides } = {}) {
  return normalizeMesContext({
    source: 'virtual-mes-benchmark',
    workOrderId: `WO-TEP-${processModeId}`,
    lotId: `LOT-TEP-${runId}`,
    productId: 'tennessee-eastman-simulation',
    recipeId: 'tep-normal-benchmark-v1',
    operationId: 'OP-TEP-CONTINUOUS',
    equipmentId, runId, processModeId,
    operationMode: 'SIMULATE', executionState: 'RUN',
    ...overrides
  });
}

export function attachMesContext(event, input) {
  if (!event || typeof event !== 'object') throw new Error('Event must be an object');
  const mesContext = normalizeMesContext(input);
  if (event.equipmentId !== mesContext.equipmentId) throw new Error('MES equipment does not match event');
  if (event.runId !== mesContext.runId) throw new Error('MES run does not match event');
  return { ...event, mesContext };
}

const TRANSITIONS = new Map([
  ['IDLE', new Set(['RUN', 'FAULT'])],
  ['RUN', new Set(['PAUSED', 'COMPLETE', 'FAULT'])],
  ['PAUSED', new Set(['RUN', 'FAULT'])],
  ['COMPLETE', new Set(['IDLE'])],
  ['FAULT', new Set(['IDLE'])]
]);

export function transitionMesState(input, nextState) {
  const context = normalizeMesContext(input);
  if (!EXECUTION_STATES.includes(nextState)) throw new Error('Invalid next executionState');
  if (!TRANSITIONS.get(context.executionState)?.has(nextState))
    throw new Error(`Invalid MES transition: ${context.executionState}->${nextState}`);
  return { ...context, executionState: nextState };
}
