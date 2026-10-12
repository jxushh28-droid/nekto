import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {confirmVoiceSession} from '../voice-session.js';

function fixture({subscribeError=false,registrationError=0}={}){
 const state={user:{authToken:'fixture-token',tokenId:null},system:{isAuth:false,socketConnected:true,errorRegistered:registrationError}};
 let listener,clock=0,next=0;const timers=new Map(),writes=[];
 const schedule=(fn,delay,interval=false)=>{const id=++next;timers.set(id,{fn,delay,at:clock+delay,interval});return id;};
 const store={state,subscribe(fn){if(subscribeError)throw Error('fixture subscription failure');listener=fn;return()=>{listener=null;};}};
 const sandbox={document:{querySelectorAll:()=>[{__vue__:{$store:store}}]},localStorage:{getItem:()=>JSON.stringify({user:{authToken:'fixture-token'}}),setItem:()=>writes.push('storage')},
  setTimeout:(fn,delay)=>schedule(fn,delay),setInterval:(fn,delay)=>schedule(fn,delay,true),clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id),Promise};
 const run=vm.runInNewContext('('+confirmVoiceSession.toString()+')',sandbox);
 return {state,timers,writes,run:()=>run({token:'fixture-token'}),
  advance(ms){const end=clock+ms;while(true){const due=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;const [id,t]=due;clock=t.at;if(t.interval)t.at+=t.delay;else timers.delete(id);t.fn();}clock=end;},
  accept(){state.user.tokenId=123;state.system.isAuth=true;listener?.();}};
}

test('native registration can finish after ten seconds within the original fifteen-second timeout',async()=>{
 const f=fixture();let settled=false;const pending=f.run().then(r=>{settled=true;return r;});
 f.advance(11000);await Promise.resolve();assert.equal(settled,false);
 f.accept();const result=await pending;assert.equal(result.ok,true);assert.equal(result.reason,'native-session-confirmed');assert.equal(f.timers.size,0);assert.deepEqual(f.writes,[]);
});
test('registration timeout and subscription failures release observers without reauthorization',async()=>{
 const timed=fixture();const pending=timed.run();timed.advance(15000);assert.equal((await pending).reason,'authorization-timeout');assert.equal(timed.timers.size,0);
 const failed=fixture({subscribeError:true});assert.equal((await failed.run()).reason,'authorization-failed');assert.equal(failed.timers.size,0);assert.deepEqual(failed.writes,[]);
});
test('non-finite registration values do not invent a native rejection',async()=>{
 const f=fixture({registrationError:Infinity});f.state.user.tokenId=0;f.state.system.isAuth=true;
 const result=await f.run();assert.equal(result.ok,true);assert.equal(result.diagnostics.registrationError,0);
});
