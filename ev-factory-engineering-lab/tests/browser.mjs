// Optional UI verification. npm install, then npm run test:browser.
// An existing playwright-core module path may also be passed as argv[2].
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.argv[2]?pathToFileURL(path.resolve(process.argv[2])).href:'playwright-core');
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let checks=0;
function check(value,message){assert.ok(value,message);checks++;}
try{
  await page.goto(pathToFileURL(path.join(root,'output','index.html')).href);
  await page.waitForSelector('#overviewKpis .value');
  check(await page.title()==='EV Factory Lab · 공정에서 판단까지','title');
  check((await page.locator('#overviewKpis .value').first().innerText()).includes('5,400'),'all units');
  await page.screenshot({path:path.join(root,'output/dashboard-overview.png'),fullPage:true});
  await page.selectOption('#day','25');
  check((await page.locator('#overviewKpis .value').first().innerText()).includes('180'),'day filter');
  await page.selectOption('#variant','B');
  const expected=await page.evaluate(()=>window.FACTORY_REPORT.units.filter(r=>r.day===25&&r.variant==='B').length);
  check((await page.locator('#overviewKpis .value').first().innerText()).replace(/[^0-9]/g,'')===String(expected),'combined filters');
  await page.fill('#unitId','INVALID');await page.locator('#traceForm button').click();
  check((await page.locator('#trace').innerText()).includes('없습니다'),'unknown trace');
  await page.fill('#unitId','d25-u0001');await page.locator('#traceForm button').click();
  check(await page.locator('.tracecell').count()===4,'trace route');
  await page.locator('[data-view="sdf"]').click();
  check(await page.locator('#sdf').isVisible(),'SDF navigation');
  check(await page.locator('#baselines tr').count()===3,'baselines');
  const before=await page.locator('#thresholdResult').innerText();
  const savedThreshold=await page.evaluate(()=>window.FACTORY_REPORT.metrics.threshold);
  await page.locator('#threshold').focus();
  await page.locator('#threshold').press('End');
  check(before!==await page.locator('#thresholdResult').innerText(),'threshold interaction');
  check(await page.evaluate(()=>window.FACTORY_REPORT.metrics.threshold)===savedThreshold,'stored threshold unchanged');
  await page.locator('[data-view="engineering"]').click();
  check(await page.locator('#scenarios tr').count()===4,'four scenarios');
  check(await page.locator('#workflow .step').count()===5,'workflow evidence');
  await page.screenshot({path:path.join(root,'output/dashboard-engineering.png'),fullPage:true});
  await page.locator('[data-view="evidence"]').click();
  for(const href of await page.locator('#evidence a').evaluateAll(nodes=>nodes.map(a=>a.href))){
    if(href.startsWith('file:'))check(fs.existsSync(fileURLToPath(href)),`linked artifact exists: ${href}`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-view="overview"]').click();
  await page.selectOption('#day','all');await page.selectOption('#variant','all');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile no horizontal overflow');
  await page.screenshot({path:path.join(root,'output/dashboard-mobile.png'),fullPage:true});
  check(errors.length===0,`browser errors: ${errors.join('; ')}`);
  const report={executed_utc:new Date().toISOString(),passed:true,checks,browser:'Microsoft Edge / Playwright',
    viewports:['1440x1080','390x844'],errors,screenshots:['dashboard-overview.png','dashboard-engineering.png','dashboard-mobile.png']};
  fs.writeFileSync(path.join(root,'output/browser-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}catch(error){
  fs.writeFileSync(path.join(root,'output/browser-verification.json'),JSON.stringify({passed:false,checks,errors,error:String(error)},null,2));
  throw error;
}finally{await browser.close();}
