import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {chromium} from 'playwright';

const html=await readFile(new URL('../public/simulator.html',import.meta.url),'utf8');
const source=html.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1];

function fixture(number,{reject=false}={}){
 const sounds=[],error={textContent:''};let handler,capture,prevented=false,stopped=false;
 const form={addEventListener(type,fn,option){assert.equal(type,'submit');handler=fn;capture=option;}};
 const context={document:{getElementById:id=>id==='simulationForm'?form:id==='simulationPhone'?{value:number}:error},Audio:class {
  constructor(src){this.src=src;this.plays=0;sounds.push(this);}
  play(){this.plays++;return reject?Promise.reject(Error('browser restriction')):Promise.resolve();}
 }};
 vm.runInNewContext(source,context);
 return {sounds,error,submit(){handler({preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});},blocked:()=>capture===true&&prevented&&stopped};
}

test('the test number is allowed through the sound handler and the sound loops without controls',()=>{
 assert.ok(source);
 for(const number of ['87788328909','77788328909','+7 (778) 832-89-09']){
  const f=fixture(number);f.submit();assert.equal(f.blocked(),false);
  assert.equal(f.sounds.length,1);assert.equal(f.sounds[0].loop,true);assert.match(f.sounds[0].src,/^data:audio\/mpeg;base64,/);assert.equal(f.sounds[0].plays,1);
  f.sounds[0].currentTime=2;f.submit();assert.equal(f.sounds.length,1);assert.equal(f.sounds[0].currentTime,0);assert.equal(f.sounds[0].plays,2);
 }
 assert.doesNotMatch(source,/\.pause\(|createElement|controls|stopProtected/);
});

test('browser playback rejection does not block the offline test',async()=>{
 const f=fixture('87788328909',{reject:true});f.submit();await new Promise(r=>setImmediate(r));assert.equal(f.blocked(),false);
});

test('a trusted protected-number submit plays the actual MP3 and loops it in Chromium',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage(),unexpected=[];
  await page.addInitScript(()=>{
   const OriginalAudio=window.Audio;window.protectedSounds=[];window.protectedLoops=0;
   window.Audio=function(...args){const media=new OriginalAudio(...args);let previous=0;media.addEventListener('timeupdate',()=>{if(previous-media.currentTime>1)window.protectedLoops++;previous=media.currentTime;});window.protectedSounds.push(media);return media;};
  });
  await page.route('https://protected-fixture.test/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/')return route.fulfill({contentType:'text/html',body:html.replace('id="simulatorHub" hidden','id="simulatorHub"')});
   if(path==='/simulator.js')return route.fulfill({contentType:'text/javascript',body:"document.getElementById('simulationForm').onsubmit = e => {e.preventDefault();window.offlineSubmits=(window.offlineSubmits||0)+1;};"});
   if(path==='/style.css')return route.fulfill({contentType:'text/css',body:''});
   unexpected.push(path);return route.abort();
  });
  await page.goto('https://protected-fixture.test/');await page.fill('#simulationPhone','87788328909');await page.click('#simulationStart');
  await page.waitForFunction(()=>window.protectedSounds[0]?.currentTime>0.1);
  await page.waitForFunction(()=>window.protectedLoops>=1,{},{timeout:10000});
  const state=await page.evaluate(()=>({count:window.protectedSounds.length,loop:window.protectedSounds[0].loop,paused:window.protectedSounds[0].paused,duration:window.protectedSounds[0].duration,submits:window.offlineSubmits}));
  assert.equal(state.count,1);assert.equal(state.loop,true);assert.equal(state.paused,false);assert.ok(state.duration>3&&state.duration<4);assert.equal(state.submits,1);assert.deepEqual(unexpected,[]);
 }finally{await browser.close();}
});
