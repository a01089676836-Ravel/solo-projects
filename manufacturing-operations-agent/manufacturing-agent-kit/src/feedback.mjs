import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
export function openFeedbackStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS feedback (
    key TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL) STRICT`);
  return {
    close: () => db.close(),
    save(key, eventId, body) {
      if (typeof key !== 'string' || !/^[\w-]{8,128}$/.test(key) || !body ||
          !['yes','no','unknown'].includes(body.verdict) || typeof body.note !== 'string' ||
          body.note.length > 2000 || Object.keys(body).some(k => !['verdict','note'].includes(k)))
        return { status: 400, body: { error: { code: 'invalid_feedback' } } };
      const payload = JSON.stringify({ eventId, verdict: body.verdict, note: body.note });
      const existing = db.prepare('SELECT payload,result FROM feedback WHERE key=?').get(key);
      if (existing) return existing.payload === payload
        ? { status: 200, body: JSON.parse(existing.result) }
        : { status: 409, body: { error: { code: 'idempotency_conflict' } } };
      const result = { feedbackId: randomUUID(), eventId, ...body,
        reviewStatus: 'pending_review', createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO feedback VALUES (?,?,?)').run(key, payload, JSON.stringify(result));
      return { status: 201, body: result };
    }
  };
}
