import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrowserProfiles} from '../browser-profile.js';

test('browser profiles survive a restart, isolate sides and discard another token identity',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'provider-profiles-'));
 const origin='https://nekto-me.kz',profiles=new BrowserProfiles(directory,origin);
 const state={cookies:[{domain:'.nekto-me.kz',name:'native',value:'private-cookie'},{domain:'audio.nekto-me.kz',name:'socket',value:'private-socket-cookie'},{domain:'.other.test',name:'unrelated',value:'discard'}],origins:[{origin,localStorage:[{name:'storage_audio_v2',value:JSON.stringify({user:{authToken:'private-token',volume:37}})}]},{origin:'https://other.test',localStorage:[{name:'unrelated',value:'discard'}]}]};
 try{
  await profiles.save(0,state,'private-token');
  const restarted=new BrowserProfiles(directory,origin),restored=await restarted.load(0,'private-token');
  assert.equal(restored.restored,true);assert.deepEqual(restored.state,{cookies:state.cookies.slice(0,2),origins:state.origins.slice(0,1)});
  assert.deepEqual(await restarted.load(1,'private-token'),{restored:false,state:{cookies:[],origins:[]}});
  assert.deepEqual(await restarted.load(0,'another-token'),{restored:false,state:{cookies:[],origins:[]}});
  assert.equal((await stat(directory+'/0.json')).mode&0o777,0o600);assert.equal((await stat(directory)).mode&0o777,0o700);
  assert.equal(state.origins.length,2);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('corrupt saved profiles fail clearly without exposing or replacing their contents',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'corrupt-profile-'));
 try{
  await writeFile(directory+'/0.json','private-corrupt-value');
  await assert.rejects(new BrowserProfiles(directory,'https://yap.chat').load(0),error=>error.message==='Saved browser profile could not be read.');
 }finally{await rm(directory,{recursive:true,force:true});}
});
