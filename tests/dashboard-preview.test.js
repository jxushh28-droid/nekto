import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';import {chromium} from 'playwright';
const base='https://preview-fixture.test';
test('shared chat renders at desktop and phone sizes and Enter sends to both sessions',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const context=await browser.newContext({viewport:{width:1180,height:1050}}),requests=[];
    const status={enabled:true,tokenSetup:false,slots:[0,1].map(i=>({label:i?'B':'A',epoch:i?'b':'a',open:true,connected:true,status:'connected',messages:[{id:1,kind:'incoming',text:i?'Привет! Как дела?':'Привет',delivery:'sent',time:i+1}]}))};
    await context.route(base+'/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.startsWith('/api/')){
        if(path==='/api/send'){const body=route.request().postDataJSON();requests.push(body);for(let i=0;i<2;i++)status.slots[i].messages.push({id:2,kind:'private',broadcastId:'preview',text:body.text,delivery:'sent',time:3});}
        return route.fulfill({json:path==='/api/status'?status:path==='/api/tokens'?{tokens:['','']}:{ok:true}});
      }
      const file=path==='/'?'index.html':path.slice(1);return route.fulfill({contentType:file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('../public/'+file,import.meta.url))});
    });
    const page=await context.newPage();await page.goto(base+'/');await page.waitForFunction(()=>!document.getElementById('message').disabled);
    await page.locator('#message').fill('Привет вам обоим');await page.locator('#message').press('Enter');await page.waitForFunction(()=>document.querySelector('.own .meta')?.textContent==='Вы → A + B');
    assert.deepEqual(requests,[{text:'Привет вам обоим',epochs:['a','b']}]);assert.equal(await page.locator('#hub textarea').count(),1);assert.equal(await page.locator('.sharedFeed .messageEye').count(),2);
    const images=await page.locator('.messageEye').evaluateAll(eyes=>eyes.map(e=>e.complete&&e.naturalWidth>0));assert.deepEqual(images,[true,true]);
    if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SCREENSHOT_DIR+'/text-desktop.png',fullPage:true});}
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/text-phone.png',fullPage:true});
  }finally{await browser.close();}
});
