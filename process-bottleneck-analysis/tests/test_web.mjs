// DOM contract tests run without a browser; these do not claim visual QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const summary=JSON.parse(fs.readFileSync(new URL('../reports/analysis.json',import.meta.url),'utf8'));
const verified=JSON.parse(fs.readFileSync(new URL('../reports/verification.json',import.meta.url),'utf8'));

class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.textContent='';this.value='';this.dataset={};this.handlers={};this.hidden=true;this.classList={add(){},remove(){}};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  addEventListener(name,fn){this.handlers[name]=fn;}
  click(){return this.handlers.click?.();}
  get firstElementChild(){return this.children[0];}
}
async function setup({fail=false,fetchCase}={}) {
  const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  elements.get('reduction').value='2';
  const document={getElementById:id=>{assert.ok(elements.has(id),`Missing DOM id ${id}`);return elements.get(id);},createElement:tag=>new Element(tag),querySelectorAll:()=>[]};
  const context=vm.createContext({document,console,encodeURIComponent,fetch:async url=>{
    if(url.startsWith('/api/case')&&fetchCase)return fetchCase(url);
    return {ok:!fail,json:async()=>fail?{error:'offline'}:url==='/api/summary'?summary:url==='/api/verification'?verified:{case_id:'fixture',event_count:1,events:[{seq:0,activity:'Start',utc:'2018-01-01T00:00:00+00:00',elapsed_days:0}]}};
  }});
  vm.runInContext(app,context);
  await new Promise(resolve=>setImmediate(resolve));
  return {elements,context};
}
test('page IDs, summary, evidence, and exclusions populate',async()=>{
  const {elements}=await setup();
  assert.equal(elements.get('error').hidden,true);
  assert.match(elements.get('cases').textContent,/160,642/);
  assert.ok(elements.get('flow').children.length>0);
  assert.equal(elements.get('edges').children.length,Math.min(summary.edges.length,20));
  assert.ok(elements.get('timeline').children.length>0);
  assert.equal(elements.get('exclusions').children.length,Object.keys(summary.exclusion_groups_nonexclusive).length);
});
test('filter and scenario controls change their output',async()=>{
  const {elements}=await setup();
  elements.get('filter').value='NO_SUCH_ACTIVITY';elements.get('filter').handlers.input();
  assert.equal(elements.get('edges').children.length,0);
  elements.get('filter').value='송장';elements.get('filter').handlers.input();
  assert.ok(elements.get('edges').children.length>0);
  elements.get('reduction').value='0';elements.get('reduction').handlers.change();
  assert.equal(elements.get('before').textContent,elements.get('after').textContent);
  elements.get('reduction').value='2';elements.get('reduction').handlers.change();
  assert.notEqual(elements.get('before').textContent,elements.get('after').textContent);
});
test('network errors are visible rather than showing successful metrics',async()=>{
  const {elements}=await setup({fail:true});
  assert.equal(elements.get('error').hidden,false);
  assert.match(elements.get('error').textContent,/offline/);
  assert.equal(elements.get('cases').textContent,'');
});

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const caseResponse=id=>({ok:true,json:async()=>({case_id:id,event_count:1,events:[{seq:0,activity:id,utc:'2018-01-01T00:00:00+00:00',elapsed_days:0}]})});
test('search ignores surrounding whitespace and supports case-insensitive English',async()=>{
  const {elements}=await setup();
  elements.get('filter').value='  invoice  ';elements.get('filter').handlers.input();
  assert.ok(elements.get('edges').children.length>0);
  elements.get('filter').value='INVOICE';elements.get('filter').handlers.input();
  assert.ok(elements.get('edges').children.length>0);
});
test('an obsolete failed case request cannot show an error after a newer success',async()=>{
  const pending=[];
  const {elements}=await setup({fetchCase:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
  const buttons=elements.get('evidence-buttons').children;
  assert.ok(buttons.length>=2);
  buttons[1].click();
  pending[1].resolve(caseResponse('latest'));await flush();
  pending[0].reject(new Error('old failure'));await flush();
  assert.equal(elements.get('error').hidden,true);
  assert.match(elements.get('case-title').textContent,/latest/);
});
test('successful retry clears the old error and loading clears the previous timeline',async()=>{
  const pending=[];
  const {elements}=await setup({fetchCase:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
  pending[0].reject(new Error('temporary failure'));await flush();
  assert.equal(elements.get('error').hidden,false);
  elements.get('evidence-buttons').children[1].click();
  pending[1].resolve(caseResponse('recovered'));await flush();
  assert.equal(elements.get('error').hidden,true);
  assert.equal(elements.get('timeline').children.length,1);
  elements.get('evidence-buttons').children[0].click();
  assert.equal(elements.get('timeline').children.length,0);
  pending[2].resolve(caseResponse('next'));await flush();
});
test('all four scenario choices match the reported outputs',async()=>{
  const {elements}=await setup();
  for(let i=0;i<4;i++){
    elements.get('reduction').value=String(i);elements.get('reduction').handlers.change();
    const expected=summary.scenarios[i].counterfactual.median_days.toLocaleString('ko-KR',{maximumFractionDigits:2})+'일';
    assert.equal(elements.get('after').textContent,expected);
  }
});
