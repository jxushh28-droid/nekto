import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {videoProvider,parseProviderSession,providerSessionPair,saveProviderConfig,loadProviderConfig} from '../video-providers.js';
import {ProviderVideoHost} from '../provider-video-host.js';
function session(provider,name='session'){return {cookies:[{name,value:'private-fixture-session',domain:provider==='umingle'?'umingle.com':'.chatruletka.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]};}
test('only Umingle and Chatruletka are available and both support independent anonymous sessions',()=>{
  assert.equal(videoProvider('umingle').url,'https://umingle.com/video/');assert.equal(videoProvider('chatruletka').origin,'https://chatruletka.com');assert.throws(()=>videoProvider('yap'));
  assert.deepEqual(providerSessionPair(['',''],'umingle'),[null,null]);assert.deepEqual(providerSessionPair([null,null],'chatruletka'),[null,null]);
});
test('session imports validate the real browser format and cannot cross provider origins',()=>{
  assert.deepEqual(parseProviderSession(JSON.stringify(session('umingle')),'umingle'),session('umingle'));
  assert.throws(()=>parseProviderSession(session('umingle'),'chatruletka'),/different provider/);
  assert.throws(()=>parseProviderSession('nekto-authToken','umingle'),/browser-session JSON/);
  assert.throws(()=>parseProviderSession({cookies:[],origins:[{origin:'https://elsewhere.test',localStorage:[]}]} ,'umingle'),/different provider/);
  assert.throws(()=>providerSessionPair([session('umingle'),session('umingle')],'umingle'),/must be different/);
});
test('imports do not replay verification or restriction state',()=>{
  for(const name of ['cf_clearance','hcaptcha_token','ban_until','fingerprint'])assert.throws(()=>parseProviderSession(session('umingle',name),'umingle'),/verification or restriction/);
});
test('provider selection and private session pairs persist independently',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'video-config-'));try{
    const config={provider:'chatruletka',sessions:{umingle:[session('umingle'),null],chatruletka:[null,session('chatruletka')]}};await saveProviderConfig(dir,config);assert.deepEqual(await loadProviderConfig(dir),config);assert.equal((await stat(dir+'/video-providers.json')).mode&0o777,0o600);
    const host=new ProviderVideoHost({data:dir,getBrowser:()=>{throw Error('No browser should be launched.');}});clearInterval(host.timer);try{await host.sessionsLoaded;await host.selectProvider('umingle');assert.equal(host.sessions[0].cookies[0].domain,'umingle.com');host.slots[0]={};await assert.rejects(host.selectProvider('chatruletka'),/Close both/);host.slots[0]=null;await host.selectProvider('chatruletka');assert.equal(host.sessions[0],null);assert.equal(host.sessions[1].cookies[0].domain,'.chatruletka.com');}finally{await host.shutdown();}
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('native verification and proxy restrictions keep the video bridge off',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'video-state-')),host=new ProviderVideoHost({data:dir,getBrowser:()=>{throw Error('No browser');}});clearInterval(host.timer);await host.sessionsLoaded;let routed=true;
  const page=state=>({mainFrame(){return this;},evaluate:async(fn,arg)=>{if(fn.toString().includes('status()'))return state;routed=!!arg?.enabled;}});
  host.slots=[{page:page({connected:true,canSend:true}),connected:true,cache:[],cacheBytes:0},{page:page({connected:false,verification:true}),connected:true,cache:[],cacheBytes:0}];host.enabled=true;
  try{await host.tick();assert.equal(host.enabled,false);assert.equal(host.slots[1].status,'verification');assert.equal(host.slots[1].connected,false);assert.equal(routed,false);}finally{host.slots=[null,null];await host.shutdown();await rm(dir,{recursive:true,force:true});}
});
