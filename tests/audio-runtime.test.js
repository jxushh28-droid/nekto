import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../browser/audio-runtime.js',import.meta.url),'utf8');
function fixture({hash="#/",elements={}}={}){let listener=()=>{},requests=0,writes=0;const state={system:{isAuth:false,socketConnected:true,errorRegistered:0},user:{authToken:'private-original-token'},chat:{activeConnectionId:null}};const store={state,subscribe:fn=>{listener=fn;return()=>{};},commit:()=>writes++};const element={__vue__:{$store:store,$socketActions:{authorize:()=>requests++}}};const sandbox={document:{querySelectorAll:()=>[element],querySelector:selector=>elements[selector]||null},window:{addEventListener:()=>{}},location:{hash},setInterval:()=>1,clearInterval:()=>{},Date,JSON};vm.runInNewContext(source,sandbox);return {state,notify:()=>listener(),client:sandbox.window.__audioHost,counts:()=>({requests,writes})};}
test('voice trace preserves a rejection followed by native token replacement without sending requests',()=>{const f=fixture();f.client.status();f.state.system.errorRegistered=424;f.notify();f.state.user.authToken='private-replacement-token';f.notify();f.state.system.errorRegistered=0;f.state.system.isAuth=true;f.notify();const trace=f.client.diagnostics();assert.ok(trace.some(e=>e.registrationError===424));assert.equal(trace.at(-1).tokenChanges,1);assert.equal(trace.at(-1).registrationError,0);assert.ok(!JSON.stringify(trace).includes('private-'));assert.deepEqual(f.counts(),{requests:0,writes:0});});
test('authenticated voice session remains visibly verification-blocked and trace is bounded',()=>{const f=fixture();f.client.status();f.state.system.isAuth=true;f.state.system.captchaRequired=true;f.notify();const status=f.client.status();assert.equal(status.status,'verification');assert.equal(status.authenticated,true);assert.equal(status.connected,false);for(let n=0;n<40;n++){f.state.user.authToken='private-token-'+n;f.notify();}assert.equal(f.client.diagnostics().length,24);assert.deepEqual(f.counts(),{requests:0,writes:0});});
test('a native disconnect reason prevents a stale call ID from enabling audio',()=>{const f=fixture();f.state.system.isAuth=true;f.state.chat.activeConnectionId='fixture-call';assert.equal(f.client.status().connected,true);f.state.system.forceDisconnectReason='fixture-disconnect';const status=f.client.status();assert.equal(status.status,'blocked');assert.equal(status.connected,false);assert.deepEqual(f.counts(),{requests:0,writes:0});});

const shown=text=>({isConnected:true,checkVisibility:()=>true,innerText:text});
test('current native searching route and loader are recognized without the obsolete scan route',()=>{
 for(const hash of ['#/searching','#/searching?test=1'])assert.equal(fixture({hash}).client.status().status,'searching');
 assert.equal(fixture({hash:'#/scan'}).client.status().status,'loading');
 assert.equal(fixture({elements:{'.chat-step.scan .search_loader':shown('')}}).client.status().status,'searching');
});
test('native isSearching state remains supported',()=>{const f=fixture();f.state.user.isSearching=true;assert.equal(f.client.status().status,'searching');});
test('ordinary native prompts require attention instead of being labeled bans or successful calls',()=>{
 const f=fixture({elements:{'.swal2-popup':shown('Укажите ваш возраст.')}});f.state.system.isAuth=true;f.state.chat.activeConnectionId='stale-call';
 const status=f.client.status();assert.equal(status.status,'attention');assert.equal(status.connected,false);assert.match(status.detail,/Укажите ваш возраст/);assert.deepEqual(f.counts(),{requests:0,writes:0});
});
test('visible native ban remains blocked when a CAPTCHA flag is also set',()=>{
 const popup=shown('БАН'),f=fixture({elements:{'.swal2-popup':popup,'.swal2-popup.banPopup':popup}});
 assert.equal(f.client.status().status,'blocked');f.state.system.captchaRequired=true;const state=f.client.status();assert.equal(state.status,'blocked');assert.equal(state.restrictionSource,'.swal2-popup.banPopup');assert.equal(state.detail,'БАН');
});
test('hidden native popups do not stop a call',()=>{
 const f=fixture({elements:{'.swal2-popup':{isConnected:true,checkVisibility:()=>false}}});f.state.system.isAuth=true;f.state.chat.activeConnectionId='fixture-call';assert.equal(f.client.status().status,'connected');
});
test('restriction checkpoint identifies the visible native mask without copying its text',()=>{
 const f=fixture({elements:{'#mask_bad_inet':shown('private native prompt')}});
 const state=f.client.status();assert.equal(state.restrictionSource,'#mask_bad_inet');assert.equal(state.disconnectCode,null);
 f.state.system.forceDisconnectReason=425;assert.equal(f.client.status().disconnectCode,425);
 assert.equal(JSON.stringify(f.client.diagnostics()).includes('private native prompt'),false);
});
