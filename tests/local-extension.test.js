import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import http from 'node:http';
import {localFixture} from './local-fixture.js';
import {localRequestError} from '../local-dashboard.js';

test('local helper needs no password, removes login forms, and rejects foreign origins and hosts',async()=>{
 const f=await localFixture();try{
  assert.equal((await (await fetch(f.base+'/health')).json()).service,'nekto-local-extension');
  for(const path of ['/api/status','/api/tokens','/api/audio/status','/api/audio/proxies','/api/video/status'])assert.equal((await fetch(f.base+path)).status,200,path);
  for(const path of ['/','/audio','/video','/simulator']){
   const html=await (await fetch(f.base+path)).text();assert.doesNotMatch(html,/id="password"|id="loginForm"/);assert.match(html,/<section id="login" hidden>/);
  }
  const post=headers=>fetch(f.base+'/api/toggle',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{"enabled":false}'});
  assert.equal((await post({Origin:f.base})).status,200);
  assert.equal((await post({Origin:'https://other.test'})).status,403);
  assert.equal((await post({})).status,403);
  assert.equal((await fetch(f.base+'/api/tokens',{headers:{Origin:'https://other.test'}})).status,403);
  assert.equal((await fetch(f.base+'/api/tokens',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const rebinding=await new Promise((resolve,reject)=>{http.get(f.base+'/api/status',{headers:{Host:'other.test:'+f.port}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(rebinding,403);
  const health=await fetch(f.base+'/health',{headers:{Origin:'chrome-extension://fixture'}});assert.equal(health.status,200);
 }finally{await f.stop();}
});

test('local policy accepts internal video fixture and denies extension access to session data',()=>{
 const env={PORT:'3000',LOCAL_DASHBOARD_PORT:'3100'};
 assert.equal(localRequestError({method:'GET',headers:{host:'127.0.0.1:3000'}},'/video-fixture',env),null);
 assert.equal(localRequestError({method:'GET',headers:{host:'127.0.0.1:3100',origin:'chrome-extension://fixture'}},'/api/tokens',env),'Invalid origin');
 assert.equal(localRequestError({method:'GET',headers:{host:'127.0.0.1:9999'}},'/health',env),'Use the local dashboard address.');
});

test('extension opens local audio only for the correct helper and falls back to setup on failure',async()=>{
 const source=(await readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace('export async function','async function');
 const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.manifest_version,3);assert.deepEqual(manifest.host_permissions,['http://127.0.0.1/*']);assert.equal(manifest.permissions,undefined);
 for(const value of ['nekto-local-extension','nekto-text-host','offline','invalid-json','http-error']){
  let clicked;const tabs=[],requests=[];
  const context={AbortSignal,console,chrome:{action:{onClicked:{addListener(fn){clicked=fn;}}},runtime:{getURL:path=>'chrome-extension://fixture/'+path},tabs:{async create(tab){tabs.push(tab.url);}}},fetch:async(url,options)=>{requests.push({url,options});if(value==='offline')throw Error('offline');return {ok:value!=='http-error',json:async()=>{if(value==='invalid-json')throw Error('bad json');return {service:value};}};}};
  vm.runInNewContext(source,context);clicked();await new Promise(r=>setImmediate(r));
  assert.deepEqual(tabs,[value==='nekto-local-extension'?'http://127.0.0.1:3100/audio':'chrome-extension://fixture/setup.html']);assert.equal(requests.length,1);assert.equal(requests[0].url,'http://127.0.0.1:3100/health');assert.equal(requests[0].options.redirect,'error');
 }
});
