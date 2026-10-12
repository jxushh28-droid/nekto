import {test} from 'node:test';import assert from 'node:assert/strict';
import {Relay} from '../relay.js';import {Transcript} from '../transcript.js';import {queueTextBroadcast} from '../text-broadcast.js';
function fixture(){const relay=new Relay();relay.toggle(true);const states=[{connected:true,epoch:'a'},{connected:true,epoch:'b'}];states.forEach((s,i)=>relay.update(i,s));return {relay,transcripts:[new Transcript(),new Transcript()],states,text:'Привет\nобоим',epochs:['a','b']};}
test('a shared message reaches both current queues unchanged and has one broadcast identity',()=>{
  const f=fixture(),result=queueTextBroadcast(f);assert.equal(result.ok,true);
  for(let i=0;i<2;i++){assert.equal(f.relay.members[i].queue.length,1);const item=f.relay.members[i].queue[0];assert.equal(item.text,f.text);assert.equal(item.broadcastId,result.broadcastId);assert.equal(item.source,undefined);assert.equal(f.relay.valid(i,item),true);assert.equal(f.transcripts[i].items[0].broadcastId,result.broadcastId);}
});
test('a disconnected or changed destination cannot partially enqueue a shared message',()=>{
  for(const change of [f=>f.states[1].connected=false,f=>f.states[1].epoch='new-b',f=>f.epochs=[]]){
    const f=fixture();change(f);assert.throws(()=>queueTextBroadcast(f),/conversation changed/);assert.deepEqual(f.relay.members.map(m=>m.queue.length),[0,0]);assert.deepEqual(f.transcripts.map(t=>t.items.length),[0,0]);
  }
});
test('full queue and invalid text reject both destinations before mutation',()=>{
  const f=fixture();for(let n=0;n<40;n++)f.relay.enqueue(1,{text:'previous'});assert.throws(()=>queueTextBroadcast(f),/queue is full/);assert.equal(f.relay.members[0].queue.length,0);assert.equal(f.relay.members[1].queue.length,40);
  for(const text of ['',null,'x'.repeat(4001)]){const f=fixture();assert.throws(()=>queueTextBroadcast({...f,text}));assert.deepEqual(f.transcripts.map(t=>t.items.length),[0,0]);}
});
test('new conversation boundaries invalidate already queued operator messages',()=>{
  const f=fixture();queueTextBroadcast(f);const old=f.relay.members[1].queue[0];f.relay.update(1,{connected:true,epoch:'replacement'});assert.equal(f.relay.valid(1,old),false);
});
