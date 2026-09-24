import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTepBenchmarkMesContext } from './mes-lite.mjs';
import { compareTepBaselines, readTepJsonl } from './tep-mode.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = ['mode_1_normal.jsonl', 'mode_3_normal.jsonl', 'mode_4_normal.jsonl'];
const rows = files.flatMap(file => readTepJsonl(resolve(root, 'data/normalized/tep', file)));
const result = compareTepBaselines(rows, { trainFraction: 0.8, normalQuantile: 0.99 });
const mesContexts = [...new Map(rows.map(row => [row.runId,
  createTepBenchmarkMesContext({ processModeId: row.processModeId, runId: row.runId })])).values()];
const report = {
  source: 'data/raw/tep/manifest.json',
  rows: rows.length,
  modes: [...new Set(rows.map(row => row.processModeId))].sort(),
  trainRows: result.modeAware.model.split.trainRows,
  holdoutRows: result.modeAware.model.split.holdoutRows,
  comparison: {
    modeAware: result.modeAware.evaluation,
    global: result.global.evaluation,
    temporal: {
      options: { persistenceRows: 3, transitionGraceRows: 2 },
      modeAware: result.modeAware.temporal,
      global: result.global.temporal
    }
  },
  comparisonDecision: result.comparisonDecision,
  virtualMes: {
    source: 'virtual-mes-benchmark',
    operationMode: 'SIMULATE',
    equipmentId: 'tep-simulation-equipment',
    contexts: mesContexts.map(context => ({
      runId: context.runId, processModeId: context.processModeId,
      workOrderId: context.workOrderId, lotId: context.lotId,
      operationId: context.operationId
    }))
  },
  limitations: result.limitations
};
writeFileSync(resolve(root, 'reports/tep-mode-baseline.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
