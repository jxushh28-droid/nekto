import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {localFixture} from './local-fixture.js';

test('password-free pages initialise and switch modes in Chromium',async()=>{
 const f=await localFixture();let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [path,hub] of [['/','#hub'],['/audio','#hub'],['/video','#videoHub'],['/simulator','#simulatorHub']]){
   await page.goto(f.base+path);await page.locator(hub).waitFor({state:'visible'});assert.equal(await page.locator('#password').count(),0);assert.equal(await page.locator('.modeTabs a').count(),4);
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await f.stop();}
});

test('MV3 service worker opens the local dashboard and shows setup after the helper stops',async()=>{
 const f=await localFixture(3100);
 const path=fileURLToPath(new URL('../extension',import.meta.url));
 let context;
 try{
  context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:['--disable-extensions-except='+path,'--load-extension='+path]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const [dashboard]=await Promise.all([context.waitForEvent('page'),worker.evaluate(()=>openDashboard())]);
  await dashboard.waitForURL('http://127.0.0.1:3100/audio');await dashboard.locator('#hub').waitFor({state:'visible'});assert.equal(await dashboard.locator('#password').count(),0);
  await f.stop();
  const [setup]=await Promise.all([context.waitForEvent('page'),worker.evaluate(()=>openDashboard())]);
  await setup.waitForURL(/chrome-extension:\/\/.*\/setup.html/);await setup.locator('h1').waitFor();assert.equal(await setup.locator('h1').textContent(),'Start your local dashboard');
 }finally{await context?.close();await f.stop();}
});
