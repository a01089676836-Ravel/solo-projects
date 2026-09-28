from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen
from urllib.parse import quote

from server import handler_factory


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        root=Path(cls.temp.name)
        (root/'web').mkdir();(root/'reports').mkdir()
        (root/'web/index.html').write_text('<html lang="ko">fixture</html>',encoding='utf-8')
        (root/'reports/analysis.json').write_text('{"eligible_cases":1}',encoding='utf-8')
        db=root/'fixture.sqlite'
        with sqlite3.connect(db) as conn:
            conn.executescript('''CREATE TABLE cases(case_id TEXT,category TEXT,company TEXT,event_count INTEGER,tied_pairs INTEGER,duplicate_candidates INTEGER);
                CREATE TABLE events(case_id TEXT,seq INTEGER,source_order INTEGER,activity TEXT,ts_us INTEGER);
                INSERT INTO cases VALUES('case_1','type','company',2,0,0);
                INSERT INTO events VALUES('case_1',0,0,'Start',0),('case_1',1,1,'End',86400000000);''')
        conn.close()
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),handler_factory(root,db))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join();cls.temp.cleanup()

    def read(self,path):
        try:
            with urlopen(self.url+path,timeout=5) as response:return response.status,response.headers,response.read()
        except HTTPError as e:
            try:return e.code,e.headers,e.read()
            finally:e.close()

    def test_summary_and_case_evidence(self):
        self.assertEqual(json.loads(self.read('/api/summary')[2])['eligible_cases'],1)
        case=json.loads(self.read('/api/case?id=case_1')[2])
        self.assertEqual(case['events'][1]['elapsed_days'],1)
        self.assertEqual(case['events'][1]['activity'],'End')

    def test_unknown_case_and_malformed_ids(self):
        self.assertEqual(self.read('/api/case?id=missing')[0],404)
        self.assertEqual(self.read('/api/case')[0],400)
        self.assertEqual(self.read('/api/case?id=a&id=b')[0],400)

    def test_parameterized_id_does_not_expand_query(self):
        self.assertEqual(self.read('/api/case?id='+quote("' OR 1=1 --"))[0],404)
        self.assertEqual(self.read('/api/case?id=case_1')[0],200)

    def test_whitelist_does_not_expose_database_or_source(self):
        for path in ('/data/fixture.sqlite','/../fixture.sqlite','/%2e%2e/fixture.sqlite','/pipeline.py'):
            self.assertEqual(self.read(path)[0],404)

    def test_security_headers_and_missing_report(self):
        status,headers,body=self.read('/')
        self.assertEqual(status,200)
        self.assertIn("script-src 'self'",headers['Content-Security-Policy'])
        self.assertEqual(headers['X-Content-Type-Options'],'nosniff')
        self.assertEqual(self.read('/api/verification')[0],503)


if __name__=='__main__':unittest.main()
