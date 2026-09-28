"""Loopback-only, read-only dashboard. No external assets or write API."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from pipeline import ROOT, DB, readonly, iso


def handler_factory(root=ROOT, db=DB):
    """Build a loopback dashboard handler with a fixed file/API allowlist."""
    root, db = Path(root), Path(db)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def reply(self, status, body, content_type="application/json; charset=utf-8"):
            """Send a no-cache response with restrictive browser security headers."""
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            """Serve approved static files or parameterized read-only case evidence."""
            parts = urlsplit(self.path)
            allowed = {"/":("web/index.html","text/html; charset=utf-8"),
                       "/app.js":("web/app.js","text/javascript; charset=utf-8"),
                       "/style.css":("web/style.css","text/css; charset=utf-8"),
                       "/api/summary":("reports/analysis.json","application/json; charset=utf-8"),
                       "/api/verification":("reports/verification.json","application/json; charset=utf-8")}
            if parts.path in allowed:
                name, kind = allowed[parts.path]
                file = root / name
                if not file.is_file():
                    return self.reply(503,{"error":"분석 결과가 없습니다. 먼저 pipeline.py all을 실행하세요."})
                return self.reply(200,file.read_bytes(),kind)
            if parts.path == "/api/case":
                ids = parse_qs(parts.query).get("id",[])
                if len(ids) != 1 or not ids[0] or len(ids[0]) > 100:
                    return self.reply(400,{"error":"유효한 사례 ID가 필요합니다."})
                if not db.exists():
                    return self.reply(503,{"error":"데이터베이스가 없습니다."})
                conn = readonly(db)
                try:
                    case = conn.execute("SELECT case_id,category,company,event_count,tied_pairs,duplicate_candidates FROM cases WHERE case_id=?",(ids[0],)).fetchone()
                    if case is None:
                        return self.reply(404,{"error":"사례를 찾을 수 없습니다."})
                    rows = conn.execute("SELECT seq,source_order,activity,ts_us FROM events WHERE case_id=? ORDER BY seq",(ids[0],)).fetchall()
                    value = dict(zip(("case_id","category","company","event_count","tied_pairs","duplicate_candidates"),case))
                    value["events"] = [{"seq":s,"source_order":o,"activity":a,"utc":iso(t),"elapsed_days":(t-rows[i-1][3])/86400000000 if i else 0} for i,(s,o,a,t) in enumerate(rows)]
                    return self.reply(200,value)
                finally:
                    conn.close()
            return self.reply(404,{"error":"허용되지 않은 경로입니다."})

    return Handler


def serve(port=8770):
    """Run the read-only dashboard on localhost and close the listener on exit."""
    server = ThreadingHTTPServer(("127.0.0.1",port),handler_factory())
    print(f"Dashboard: http://127.0.0.1:{port} (read-only; Ctrl+C to stop)",flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
