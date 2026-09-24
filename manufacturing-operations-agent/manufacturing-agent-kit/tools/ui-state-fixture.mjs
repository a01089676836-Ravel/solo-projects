// Development-only server: serves the real UI with controlled list responses.
// No database access; run node tools/ui-state-fixture.mjs, then /empty or /retry.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../src/ui.html', import.meta.url));
let failNext = false;
createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  if (path === '/empty' || path === '/retry') {
    failNext = path === '/retry';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  } else if (path === '/events') {
    const failed = failNext;
    failNext = false;
    res.writeHead(failed ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(failed ? { error: { code: 'database_unavailable' } } : { total: 0, items: [] }));
    console.log(`GET /events -> ${failed ? 503 : 200}`);
  } else { res.writeHead(404).end(); }
}).listen(8766, '127.0.0.1', () => console.log('UI fixture: http://127.0.0.1:8766/empty or /retry (single browser tab)'));
