import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.DASHBOARD_URL || 'http://127.0.0.1:8771';
const output=path.join(root,'reports/browser');
await fs.mkdir(output,{recursive:true});
const summary=await (await fetch(`${base}/api/summary`)).json();
const shown=n=>n.toLocaleString('ko-KR',{maximumFractionDigits:2});
const result={created_utc:new Date().toISOString(),url:base,browser:'Google Chrome (headless)',checks:[],page_errors:[],screenshots:[],passed:false};
let browser,context,page;
async function check(name,fn){await fn();result.checks.push({name,passed:true});console.log(`PASS ${name}`);}
async function screenshot(name,locator){const target=path.join(output,name);await (locator || page).screenshot({path:target});result.screenshots.push(name);}
async function settledCase(target=page){await target.waitForFunction(()=>document.querySelector('#timeline').children.length>0&&!document.querySelector('#case-title').textContent.includes('불러오는 중'));}
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  result.browser_version=browser.version();
  context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR'});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page=await context.newPage();
  page.on('pageerror',e=>result.page_errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await settledCase();
  await check('served web assets match reviewed project files',async()=>{
    result.web_sha256={};
    for(const [file,url] of [['web/app.js','/app.js'],['web/index.html','/'],['web/style.css','/style.css']]){
      const local=crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
      const served=crypto.createHash('sha256').update(Buffer.from(await(await fetch(base+url)).arrayBuffer())).digest('hex');
      assert.equal(served,local);result.web_sha256[file]=local;
    }
  });
  await check('desktop dashboard values and verification status',async()=>{
    assert.equal(await page.locator('#cases').innerText(),`${shown(summary.eligible_cases)}건`);
    assert.equal(await page.locator('#median').innerText(),`${shown(summary.cycle.median_days)}일`);
    assert.match(await page.locator('#verification').innerText(),/독립 검증 통과/);
    assert.equal(await page.locator('#error').isVisible(),false);
    assert.equal(await page.locator('#edges tr').count(),20);
  });
  await screenshot('desktop-overview.png');
  await check('Korean, English, whitespace and empty-result search',async()=>{
    for(const query of ['송장','INVOICE','  invoice  ']){
      await page.locator('#filter').fill(query);
      assert.ok(await page.locator('#edges tr').count()>0);
      const rows=await page.locator('#edges tr').allInnerTexts();
      assert.ok(rows.every(row=>/invoice|송장/i.test(row)));
    }
    await page.locator('#filter').fill('NO_SUCH_ACTIVITY');
    assert.equal(await page.locator('#edges tr').count(),0);
    assert.match(await page.locator('#table-info').innerText(),/0개 구간/);
    await page.locator('#filter').fill('');
    assert.equal(await page.locator('#edges tr').count(),20);
  });
  await check('select transition and another case; compare actual API timeline',async()=>{
    await page.locator('#edges tr').nth(1).getByRole('button',{name:'사례 보기'}).click();
    await settledCase();
    assert.ok((await page.locator('#edge-title').innerText()).includes('입고 기록 → 송장 접수 기록'));
    const button=page.locator('#evidence-buttons button').nth(1);
    const id=(await button.innerText()).split(' · ')[0];
    await button.click();
    await page.waitForFunction(id=>document.querySelector('#case-title').textContent.includes(id)&&!document.querySelector('#case-title').textContent.includes('불러오는 중'),id);
    const actual=await(await fetch(`${base}/api/case?id=${encodeURIComponent(id)}`)).json();
    assert.equal(await page.locator('#timeline li').count(),actual.events.length);
    assert.equal(await button.getAttribute('class'),'active');
    assert.equal(await page.locator('#timeline time').first().innerText(),actual.events[0].utc.replace('T',' ').replace('+00:00',' UTC'));
  });
  await check('0%, 10%, 20%, 30% scenario choices and unchanged baseline',async()=>{
    for(let i=0;i<4;i++){
      await page.locator('#reduction').selectOption(String(i));
      assert.equal(await page.locator('#after').innerText(),`${shown(summary.scenarios[i].counterfactual.median_days)}일`);
      assert.equal(await page.locator('#before').innerText(),`${shown(summary.cycle.median_days)}일`);
    }
    await page.locator('#reduction').selectOption('2');
  });
  await screenshot('desktop-cases.png',page.locator('.two-col'));
  await check('case failure and successful retry clear stale error',async()=>{
    await page.route('**/api/case?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'intentional QA outage'})}));
    await page.locator('#evidence-buttons button').first().click();
    await page.locator('#error').waitFor({state:'visible'});
    assert.equal(await page.locator('#timeline li').count(),0);
    await page.unroute('**/api/case?**');
    await page.locator('#evidence-buttons button').first().click();await settledCase();
    assert.equal(await page.locator('#error').isVisible(),false);
  });
  await check('rapid case changes ignore an older delayed failed response',async()=>{
    let pendingResolve;const pending=new Promise(r=>pendingResolve=r);let first=true;
    await page.route('**/api/case?**',async route=>{
      if(first){first=false;pendingResolve(route);}else await route.continue();
    });
    await page.locator('#evidence-buttons button').first().click();
    const delayed=await pending;
    const second=page.locator('#evidence-buttons button').nth(1);
    const id=(await second.innerText()).split(' · ')[0];
    await second.click();await settledCase();
    assert.match(await page.locator('#case-title').innerText(),new RegExp(id));
    await delayed.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'obsolete request'})});
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#error').isVisible(),false);
    assert.match(await page.locator('#case-title').innerText(),new RegExp(id));
    await page.unroute('**/api/case?**');
  });
  await check('desktop has no page-wide horizontal overflow',async()=>{
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  });
  await page.setViewportSize({width:390,height:844});await page.goto(base,{waitUntil:'networkidle'});await settledCase();
  await check('390px mobile layout and all interactive controls',async()=>{
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.locator('#filter').fill('가격');assert.ok(await page.locator('#edges tr').count()>0);
    await page.locator('#edges tr').first().getByRole('button',{name:'사례 보기'}).click();await settledCase();
    await page.locator('#reduction').selectOption('3');
    assert.equal(await page.locator('#after').innerText(),`${shown(summary.scenarios[3].counterfactual.median_days)}일`);
    await page.locator('#filter').fill('');
  });
  await page.evaluate(()=>scrollTo(0,0));await screenshot('mobile-overview.png');
  await screenshot('mobile-cases.png',page.locator('.two-col'));
  await check('no uncaught JavaScript errors',async()=>assert.deepEqual(result.page_errors,[]));
  result.passed=true;
}catch(error){result.failure=error.stack;console.error(error);if(page)await screenshot('failure.png').catch(()=>{});process.exitCode=1;}
finally{
  if(context)await context.tracing.stop({path:path.join(output,'trace.zip')}).catch(()=>{});
  if(browser)await browser.close();
  result.app_sha256=crypto.createHash('sha256').update(await fs.readFile(path.join(root,'web/app.js'))).digest('hex');
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,browser:result.browser_version,report:path.join(output,'results.json')}));
}
