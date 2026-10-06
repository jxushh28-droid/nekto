import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {primeVoiceStorage} from '../voice-bootstrap.js';

// Exact storage operation from the uploaded prime extension, with a fixture
// credential. Every web request is fulfilled locally; no Nekto connection.
const prime=`(() => {
 const TOKEN = "fixture-voice-token";
 const KEY = "storage_audio_v2";
 const write = () => {
  try {
   const saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
   if (saved?.user?.authToken === TOKEN) return true;
   saved.user = saved.user || {};
   saved.user.authToken = TOKEN;
   localStorage.setItem(KEY, JSON.stringify(saved));
   return true;
  } catch { return false; }
 };
 if (!write()) document.addEventListener("readystatechange", write, { once: true });
})();`;

test('actual MV3 isolated-world extension and init script seed identical first-script state',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'voice-extension-'));
 const extension=join(directory,'extension');await mkdir(extension);
 await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Voice storage fixture',version:'1.0',content_scripts:[{matches:['https://nekto-me.kz/*'],js:['prime.js'],run_at:'document_start',all_frames:true}],host_permissions:['https://nekto-me.kz/*']}));
 await writeFile(join(extension,'prime.js'),prime);
 const results=[];let context;
 try{
  for(const useExtension of [true,false]){
   context=await chromium.launchPersistentContext(join(directory,useExtension?'extension-profile':'init-profile'),{channel:'chromium',headless:true,args:useExtension?['--disable-extensions-except='+extension,'--load-extension='+extension]:[]});
   if(!useExtension)await context.addInitScript(primeVoiceStorage,'fixture-voice-token');
   await context.route('**/*',route=>{const iframe=new URL(route.request().url()).pathname==='/audiochat'?'<iframe src="/frame"></iframe>':'';return route.fulfill({contentType:'text/html',body:'<!doctype html><script>window.firstScriptState=JSON.parse(localStorage.getItem("storage_audio_v2")||"{}");</script>'+iframe});});
   const page=await context.newPage();await page.goto('https://nekto-me.kz/audiochat');
   assert.equal(page.frames().length,2);
   for(const frame of page.frames())assert.equal(await frame.evaluate(()=>window.firstScriptState.user.authToken),'fixture-voice-token');
   await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('storage_audio_v2'));saved.user.volume=37;saved.chat={lastStartDialogTime:123};localStorage.setItem('storage_audio_v2',JSON.stringify(saved));});
   await page.reload();results.push(await page.evaluate(()=>window.firstScriptState));
   await context.close();context=null;
  }
  assert.deepEqual(results[0],results[1]);
  assert.deepEqual(results[0],{user:{authToken:'fixture-voice-token',volume:37},chat:{lastStartDialogTime:123}});
 }finally{await context?.close();await rm(directory,{recursive:true,force:true});}
});
