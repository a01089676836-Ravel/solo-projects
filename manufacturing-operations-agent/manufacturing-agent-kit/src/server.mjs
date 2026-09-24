import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { openEventStore, EVENT_ID, ROOT } from './events.mjs';
import { readFileSync } from 'node:fs';
import { openFeedbackStore } from './feedback.mjs';

export function createApiServer(store, feedback) {
  return createServer(async (req, res) => {
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
      res.end(JSON.stringify(body));
    };
    const error = (status, code) => send(status, { error: { code } });
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
      return res.end(readFileSync(new URL('./ui.html', import.meta.url)));
    }
    if (req.method === 'POST' && /^\/events\/evt_[a-f0-9]{64}\/feedback$/.test(req.url)) {
      if (!feedback) return error(503, 'feedback_unavailable');
      const origin = req.headers.origin;
      if ((origin && origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site')
        return error(403, 'origin_rejected');
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return error(415, 'json_required');
      try {
        const id = req.url.split('/')[2];
        if (!store.get(id)) return error(404, 'event_not_found');
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) return error(413, 'body_too_large');
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return error(400, 'invalid_json'); }
        const result = feedback.save(req.headers['idempotency-key'], id, body);
        return send(result.status, result.body);
      } catch { return error(503, 'storage_unavailable'); }
    }
    if (req.method !== 'GET') return send(405, { error: { code: 'method_not_allowed' } }, { Allow: 'GET' });
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch { return error(400, 'invalid_url'); }
    const isList = url.pathname === '/events';
    const isHealth = url.pathname === '/health';
    const isDetail = url.pathname.startsWith('/events/');
    if (!isList && !isHealth && !isDetail) return error(404, 'route_not_found');
    const allowed = isList ? ['limit', 'offset'] : [];
    for (const key of url.searchParams.keys())
      if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) return error(400, 'invalid_query');
    try {
      if (isHealth) { store.count(); return send(200, { status: 'ok', mode: 'synthetic_read_only' }); }
      if (isList) {
        const rawLimit = url.searchParams.get('limit') ?? '50';
        const rawOffset = url.searchParams.get('offset') ?? '0';
        const limit = Number(rawLimit), offset = Number(rawOffset);
        if (!/^[1-9]\d*$/.test(rawLimit) || !/^(0|[1-9]\d*)$/.test(rawOffset) ||
            !Number.isSafeInteger(limit) || limit > 100 || !Number.isSafeInteger(offset))
          return error(400, 'invalid_pagination');
        return send(200, store.list(limit, offset));
      }
      const id = url.pathname.slice('/events/'.length);
      if (!EVENT_ID.test(id)) return error(400, 'invalid_event_id');
      const event = store.get(id);
      return event ? send(200, event) : error(404, 'event_not_found');
    } catch { return error(503, 'storage_unavailable'); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? '8765');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  let store;
  try { store = openEventStore(undefined, { readOnly: true }); }
  catch { console.error('Event database unavailable. Run: node src/import-events.mjs'); process.exit(1); }
  const feedback = openFeedbackStore(resolve(ROOT, 'data/feedback.sqlite'));
  const server = createApiServer(store, feedback);
  server.once('error', error => { console.error(`API failed: ${error.code ?? 'unknown'}`); store.close(); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Event API: http://127.0.0.1:${port}/events (read-only, synthetic)`));
  const stop = () => server.close(() => { feedback.close(); store.close(); process.exitCode = 0; });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
