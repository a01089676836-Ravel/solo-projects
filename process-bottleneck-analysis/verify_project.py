"""Run real checks and preserve exit codes/output. Optional Node DOM-contract check."""
from datetime import datetime, timezone
import json
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parent


def main():
    """Run available checks and save their actual output and exit codes."""
    sys.stdout.reconfigure(encoding='utf-8',errors='replace')
    commands=[[sys.executable,'-m','unittest','discover','-s','tests','-v'],[sys.executable,'pipeline.py','verify']]
    node=shutil.which('node')
    if not node:
        for candidate in (Path('C:/Program Files/nodejs/node.exe'),Path('C:/PROGRA~1/nodejs/node.exe')):
            if candidate.exists():node=str(candidate);break
    if node:commands.append([node,'--test','tests/test_web.mjs'])
    logs=[];results=[]
    for cmd in commands:
        run=subprocess.run(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,encoding='utf-8',errors='replace')
        logs.append('COMMAND: '+' '.join(cmd)+'\nEXIT CODE: '+str(run.returncode)+'\n'+run.stdout)
        results.append({'command':cmd,'exit_code':run.returncode})
        print(run.stdout,flush=True)
    browser_report=ROOT/'reports/browser/results.json'
    browser_current=False
    if browser_report.exists():
        browser=json.loads(browser_report.read_text(encoding='utf-8'))
        browser_current=bool(browser.get('passed') and browser.get('web_sha256')) and all(
            hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest for name,digest in browser.get('web_sha256',{}).items())
    outcome={'created_utc':datetime.now(timezone.utc).isoformat(),'runs':results,
             'passed':all(r['exit_code']==0 for r in results),'node_dom_contract_test_executed':bool(node),
             'browser_interaction_qa':'passed_current_web_assets' if browser_current else 'not_verified_for_current_web_assets',
             'note':'DOM tests use a test double; actual Chrome interaction evidence is recorded separately in reports/browser/results.json'}
    (ROOT/'reports/test-results.txt').write_text('\n\n'.join(logs),encoding='utf-8')
    (ROOT/'reports/test-results.json').write_text(json.dumps(outcome,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if not outcome['passed']:raise SystemExit(1)


if __name__=='__main__':main()
