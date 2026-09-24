import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURES, parseDataset, score } from './baseline.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DB = resolve(ROOT, 'data/events.sqlite');
export const EVENT_ID = /^evt_[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const UNITS = ['K', 'K', 'rpm', 'Nm', 'min'];
// Canonical JSON makes idempotency independent of object insertion order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function eventId(event) {
  return `evt_${hash(canonical([event.datasetSHA256, event.modelFingerprint, event.sampleId]))}`;
}

export function loadDevelopmentEvents(projectRoot = ROOT) {
  const configBytes = readFileSync(resolve(projectRoot, 'experiment.json'));
  const config = JSON.parse(configBytes);
  const dataBytes = readFileSync(resolve(projectRoot, config.csv));
  const artifact = JSON.parse(readFileSync(resolve(projectRoot, 'reports/baseline.json')));
  const codeBytes = readFileSync(resolve(projectRoot, 'src/baseline.mjs'));
  if (hash(dataBytes) !== config.sha256 || artifact.provenance.datasetSHA256 !== config.sha256 ||
      artifact.provenance.configSHA256 !== hash(configBytes) || artifact.provenance.codeSHA256 !== hash(codeBytes))
    throw new Error('Data/config/code differs from baseline artifact; review and regenerate baseline explicitly');
  // A fixed interface baseline, not a winner selected from test performance.
  const model = artifact.models.find(item => item.model === 'max_abs_z');
  if (!model || !Number.isFinite(model.threshold) || model.threshold < 0 ||
      artifact.stats.length !== FEATURES.length || artifact.stats.some((s, i) =>
        s.feature !== FEATURES[i] || !Number.isFinite(s.mean) || !Number.isFinite(s.std) || s.std <= 0))
    throw new Error('Invalid baseline parameters');
  const modelFingerprint = hash(canonical({ version: artifact.version, model: model.model,
    threshold: model.threshold, stats: artifact.stats, provenance: {
      datasetSHA256: artifact.provenance.datasetSHA256, configSHA256: artifact.provenance.configSHA256,
      codeSHA256: artifact.provenance.codeSHA256 } }));
  const rows = parseDataset(dataBytes.toString('utf8'));
  if (rows.length !== config.expectedRows) throw new Error('Unexpected dataset size');
  // No test scoring, fitting or threshold adjustment in this import path.
  return rows.filter(row => row.UDI >= config.validationStart && row.UDI <= config.validationEnd)
    .map(row => {
      const event = { schemaVersion: 1, dataset: 'UCI AI4I 2020', synthetic: true,
        datasetSHA256: config.sha256, sampleId: row.UDI, sampleSplit: 'validation',
        validationRange: [config.validationStart, config.validationEnd],
        equipmentId: null, observedAt: null, freshness: { status: 'unknown', reason: 'source_timestamp_missing' },
        score: score(row, artifact.stats, model.model), threshold: model.threshold,
        model: model.model, modelVersion: artifact.version, modelFingerprint,
        status: 'open', severity: 'unassigned',
        measurements: FEATURES.map((name, i) => ({ name, value: row[name], unit: UNITS[i] })),
        limitations: ['Synthetic sample alert, not a confirmed equipment failure',
          'Anomaly score is not a failure probability', 'No observed timestamp or machine identifier',
          'No SOP evidence or causal diagnosis available'] };
      return { ...event, eventId: eventId(event) };
    }).filter(event => event.score > event.threshold);
}

function validateEvent(event) {
  if (!event || event.schemaVersion !== 1 || !EVENT_ID.test(event.eventId) ||
      !HASH.test(event.datasetSHA256) || !HASH.test(event.modelFingerprint) || event.eventId !== eventId(event))
    throw new Error('Invalid event identity');
  const range = event.validationRange;
  if (!Number.isSafeInteger(event.sampleId) || !Array.isArray(range) || range.length !== 2 ||
      !range.every(Number.isSafeInteger) || range[0] <= 0 || range[0] > range[1] ||
      event.sampleId < range[0] || event.sampleId > range[1] || event.sampleSplit !== 'validation')
    throw new Error('Only validation samples are accepted');
  if (event.synthetic !== true || event.equipmentId !== null || event.observedAt !== null ||
      event.freshness?.status !== 'unknown' || event.freshness?.reason !== 'source_timestamp_missing')
    throw new Error('Synthetic source metadata must remain explicit');
  if (!Number.isFinite(event.score) || !Number.isFinite(event.threshold) ||
      event.threshold < 0 || event.score <= event.threshold || event.model !== 'max_abs_z' ||
      typeof event.modelVersion !== 'string' || !event.modelVersion ||
      event.status !== 'open' || event.severity !== 'unassigned') throw new Error('Invalid alarm score or status');
  if (!Array.isArray(event.measurements) || event.measurements.length !== FEATURES.length ||
      event.measurements.some((m, i) => m.name !== FEATURES[i] || m.unit !== UNITS[i] ||
        !Number.isFinite(m.value) || m.value < 0)) throw new Error('Invalid or missing measurement');
}

export function openEventStore(path = DEFAULT_DB, { readOnly = false } = {}) {
  if (!readOnly && path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { readOnly });
  try {
    if (!readOnly) db.exec(`
      CREATE TABLE IF NOT EXISTS anomaly_events (
        event_id TEXT PRIMARY KEY,
        sample_id INTEGER NOT NULL,
        dataset_sha256 TEXT NOT NULL,
        model_fingerprint TEXT NOT NULL,
        payload TEXT NOT NULL CHECK(json_valid(payload)),
        stored_at TEXT NOT NULL,
        UNIQUE(dataset_sha256, model_fingerprint, sample_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS events_sample_idx ON anomaly_events(sample_id, event_id);
    `);
    const get = db.prepare('SELECT payload, stored_at FROM anomaly_events WHERE event_id = ?');
    const list = db.prepare('SELECT payload, stored_at FROM anomaly_events ORDER BY sample_id, event_id LIMIT ? OFFSET ?');
    const count = db.prepare('SELECT count(*) AS total FROM anomaly_events');
    const decode = row => row ? { ...JSON.parse(row.payload), storedAt: row.stored_at } : null;
    return {
      close: () => db.close(),
      count: () => count.get().total,
      get(id) { if (!EVENT_ID.test(id)) throw new Error('Invalid event ID'); return decode(get.get(id)); },
      list(limit = 50, offset = 0) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
            !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid pagination');
        return { items: list.all(limit, offset).map(decode), total: count.get().total, limit, offset };
      },
      save(events) {
        if (readOnly) throw new Error('Read-only event store');
        events.forEach(validateEvent);
        const insert = db.prepare(`INSERT INTO anomaly_events
          (event_id, sample_id, dataset_sha256, model_fingerprint, payload, stored_at) VALUES (?, ?, ?, ?, ?, ?)`);
        let inserted = 0, duplicates = 0;
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const event of events) {
            const payload = canonical(event);
            const existing = get.get(event.eventId);
            if (existing) {
              if (existing.payload !== payload) throw new Error(`Conflicting event payload: ${event.eventId}`);
              duplicates++;
            } else {
              insert.run(event.eventId, event.sampleId, event.datasetSHA256,
                event.modelFingerprint, payload, new Date().toISOString());
              inserted++;
            }
          }
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return { inserted, duplicates, total: count.get().total };
      }
    };
  } catch (error) { db.close(); throw error; }
}
