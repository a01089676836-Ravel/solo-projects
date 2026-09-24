import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFeedbackStore } from '../src/feedback.mjs';
import { createApiServer } from '../src/server.mjs';
import { openEventStore, loadDevelopmentEvents } from '../src/events.mjs';
test('feedback persists pending status; retries deduplicate and conflicting keys fail',()=>{
 const dir=mkdtempSync(join(tmpdir(),'feedback-'));const path=join(dir,'feedback.sqlite');let f=openFeedbackStore(path);
 try{const body={verdict:'unknown',note:'확인 전'};const first=f.save('request-123','event',body);assert.equal(first.status,201);f.close();f=openFeedbackStore(path);assert.deepEqual(f.save('request-123','event',body),{status:200,body:first.body});assert.equal(first.body.reviewStatus,'pending_review');assert.equal(f.save('request-123','event',{...body,verdict:'yes'}).status,409);for(const invalid of [{verdict:'bad',note:''},{verdict:'yes',note:'x'.repeat(2001)},{verdict:'yes',note:'',reviewStatus:'approved'}])assert.equal(f.save('request-456','event',invalid).status,400)}finally{f.close();rmSync(path);rmdirSync(dir)}
});
test('HTTP feedback validates origin, content, event existence and preserves event state',async t=>{
 const store=openEventStore(':memory:'),feedback=openFeedbackStore(':memory:');const event=loadDevelopmentEvents()[0];store.save([event]);const before=store.get(event.eventId);const server=createApiServer(store,feedback);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(r=>server.close(r));store.close();feedback.close()});const base=`http://127.0.0.1:${server.address().port}`;
 const request=(id=event.eventId,body=JSON.stringify({verdict:'no',note:'검토 필요'}),headers={})=>fetch(`${base}/events/${id}/feedback`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'http-key-123',...headers},body});
 const first=await request();assert.equal(first.status,201);const result=await first.json();assert.equal(result.reviewStatus,'pending_review');const retry=await request();assert.equal(retry.status,200);assert.deepEqual(await retry.json(),result);assert.equal((await request(undefined,undefined,{Origin:'https://foreign.example'})).status,403);assert.equal((await request(undefined,undefined,{'Content-Type':'text/plain'})).status,415);assert.equal((await request(undefined,'{')).status,400);assert.equal((await request('evt_'+'0'.repeat(64))).status,404);assert.equal((await request(undefined,JSON.stringify({verdict:'yes',note:''}))).status,409);assert.deepEqual(store.get(event.eventId),before);const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);
});
