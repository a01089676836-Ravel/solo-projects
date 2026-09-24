import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

function isSafeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
}

async function atomicWriteText(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tempPath, contents, 'utf8');
    await rename(tempPath, filePath);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Phase 1의 로컬 저장소다. 서버와 저장소를 분리해 두어 나중에 PostgreSQL로 교체한다.
 */
export function createFileStore({ rootDir }) {
  const runsDir = path.join(rootDir, 'runs');
  const idempotencyDir = path.join(rootDir, 'idempotency');
  const auditPath = path.join(rootDir, 'audit.jsonl');
  let writeQueue = Promise.resolve();
  let lastAuditHash = null;

  function withWriteLock(task) {
    const pending = writeQueue.then(task);
    writeQueue = pending.catch(() => {});
    return pending;
  }

  async function init() {
    await mkdir(runsDir, { recursive: true });
    await mkdir(idempotencyDir, { recursive: true });
    const existingAudit = await readAuditRecords();
    lastAuditHash = existingAudit.at(-1)?.eventHash ?? null;
  }

  function runPath(runId) {
    return isSafeId(runId) ? path.join(runsDir, `${runId}.json`) : null;
  }

  function idempotencyPath(idempotencyId) {
    return isSafeId(idempotencyId) ? path.join(idempotencyDir, `${idempotencyId}.json`) : null;
  }

  function hashAuditRecord(record) {
    return createHash('sha256').update(JSON.stringify(record)).digest('hex');
  }

  async function readAuditRecords() {
    try {
      const raw = await readFile(auditPath, 'utf8');
      return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function appendAudit(event) {
    const unsignedRecord = { ...event, previousEventHash: lastAuditHash };
    const record = { ...unsignedRecord, eventHash: hashAuditRecord(unsignedRecord) };
    await appendFile(auditPath, `${JSON.stringify(record)}\n`, 'utf8');
    lastAuditHash = record.eventHash;
  }

  async function createRun(run, auditEvent, idempotencyRecord) {
    return withWriteLock(async () => {
      if (idempotencyRecord) {
        const existingRecord = await readJson(idempotencyPath(idempotencyRecord.idempotencyId));
        if (existingRecord) {
          return {
            replayed: true,
            conflict: existingRecord.inputHash !== idempotencyRecord.inputHash,
            run: await readJson(runPath(existingRecord.runId))
          };
        }
      }
      await atomicWriteText(runPath(run.runId), `${JSON.stringify(run, null, 2)}\n`);
      if (idempotencyRecord) {
        await atomicWriteText(idempotencyPath(idempotencyRecord.idempotencyId), `${JSON.stringify(idempotencyRecord, null, 2)}\n`);
      }
      await appendAudit(auditEvent);
      return { replayed: false, conflict: false, run };
    });
  }

  async function updateRun(run, auditEvent) {
    return withWriteLock(async () => {
      const target = runPath(run.runId);
      if (!target || !(await readJson(target))) return null;
      await atomicWriteText(target, `${JSON.stringify(run, null, 2)}\n`);
      await appendAudit(auditEvent);
      return run;
    });
  }

  async function getRun(runId) {
    const target = runPath(runId);
    return target ? readJson(target) : null;
  }

  async function getIdempotencyRecord(idempotencyId) {
    const target = idempotencyPath(idempotencyId);
    return target ? readJson(target) : null;
  }

  async function listRuns() {
    const names = await readdir(runsDir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
    const runs = [];
    for (const name of names.filter(item => item.endsWith('.json'))) {
      const run = await readJson(path.join(runsDir, name));
      if (run) runs.push(run);
    }
    return runs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function listAudit() {
    return readAuditRecords();
  }

  async function verifyAuditIntegrity() {
    const events = await readAuditRecords();
    let previousHash = null;
    let chainStarted = false;
    let legacyEventCount = 0;
    for (const event of events) {
      if (typeof event.eventHash !== 'string') {
        legacyEventCount += 1;
        chainStarted = false;
        previousHash = null;
        continue;
      }
      const { eventHash, ...unsignedRecord } = event;
      const validLink = !chainStarted || unsignedRecord.previousEventHash === previousHash;
      const validHash = eventHash === hashAuditRecord(unsignedRecord);
      if (!validLink || !validHash) {
        return {
          valid: false,
          eventCount: events.length,
          legacyEventCount,
          invalidEventId: event.eventId ?? null
        };
      }
      chainStarted = true;
      previousHash = eventHash;
    }
    return { valid: true, eventCount: events.length, legacyEventCount, lastEventHash: previousHash };
  }

  return { init, createRun, updateRun, getRun, getIdempotencyRecord, listRuns, listAudit, verifyAuditIntegrity };
}
