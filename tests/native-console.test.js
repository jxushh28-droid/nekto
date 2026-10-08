import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {AudioHost} from '../audio-host.js';
import {formatNativeConsoleValue} from '../native-console.js';

test('console formats strings, circular objects and undefined with bounded output',()=>{
 const circular={token:'actual-fixture-token'};circular.self=circular;
 assert.equal(formatNativeConsoleValue(undefined),'undefined');
 assert.equal(formatNativeConsoleValue('full-fixture-token'),'full-fixture-token');
 assert.equal(JSON.parse(formatNativeConsoleValue(circular)).self,'[Circular]');
 assert.equal(formatNativeConsoleValue('x'.repeat(15000)).length,12000);
});

test('console uses only the selected live page, rejects invalid execution, and disposes handles',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'console-host-'));
 const host=new AudioHost({data:dir,graph:{process:false,close:async()=>{}}});clearInterval(host.timer);await host.loaded;
 let executions=0,disposals=0;
 const page=new EventEmitter();page.url=()=> 'https://nekto-me.kz/audiochat';
 page.evaluateHandle=async code=>{executions++;assert.equal(code,'window.nativeFixture');return {evaluate:async fn=>fn('actual-native-page-value'),dispose:async()=>disposals++};};
 const s=host.slots[0]={page,epoch:'native-console-epoch',profileIdentity:'different-configured-token',browser:{close:async()=>{}}};
 try{
  for(const data of [{epoch:'old',code:'window.nativeFixture'},{epoch:s.epoch,code:''},{epoch:s.epoch,code:'a'.repeat(8001)}])await assert.rejects(host.console(0,data));
  host.ops.add(0);await assert.rejects(host.console(0,{epoch:s.epoch,code:'window.nativeFixture'}),/busy/);host.ops.delete(0);
  assert.equal(executions,0);
  const r=await host.console(0,{epoch:s.epoch,code:'window.nativeFixture'});
  assert.equal(r.value,'actual-native-page-value');assert.equal(r.pageURL,page.url());assert.equal(r.browserEpoch,s.epoch);assert.equal(JSON.stringify(r).includes(s.epoch),false);
  assert.equal(disposals,1);assert.equal(page.listenerCount('console'),0);assert.equal(host.ops.size,0);assert.equal(host.attempts[0],null);
  page.url=()=> 'https://unrelated.test';await assert.rejects(host.console(0,{epoch:s.epoch,code:'window.nativeFixture'}),/left Nekto/);assert.equal(executions,1);
  page.url=()=> 'https://nekto-me.kz/audiochat';page.evaluateHandle=async()=>{s.epoch='replacement';return {evaluate:async()=> 'stale',dispose:async()=>{}};};
  await assert.rejects(host.console(0,{epoch:'native-console-epoch',code:'window.nativeFixture'}),/changed/);
  assert.equal(page.listenerCount('console'),0);assert.equal(host.ops.size,0);
 }finally{host.slots[0]=null;await host.shutdown();await rm(dir,{recursive:true,force:true});}
});
