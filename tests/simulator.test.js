import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

test('simulator dispatches a job and renders polled events',async()=>{
 const {window,document}=parseHTML(await readFile(new URL('../public/simulator.html',import.meta.url),'utf8'));
 const calls=[];let tick=null;const jobId='job1';let polls=0;
 const fetch=async(url,opts)=>{
  calls.push({url,opts});
  if(url==='/api/status')return{ok:true,json:async()=>({ok:true})};
  if(url==='/api/dispatch')return{ok:true,json:async()=>({id:jobId,phone:'+77780000000',total:2})};
  if(url==='/api/job/'+jobId){
   polls++;
   if(polls===1)return{ok:true,json:async()=>({id:jobId,phone:'+77780000000',total:2,sent:1,failed:0,done:false,elapsed:0.5,events:[{seq:1,channel:'sms',name:'ep1',status:'sent',http:200,error:null}]})};
   return{ok:true,json:async()=>({id:jobId,phone:'+77780000000',total:2,sent:2,failed:0,done:true,elapsed:1,events:[{seq:1,channel:'sms',name:'ep1',status:'sent',http:200,error:null},{seq:2,channel:'call',name:'ep2',status:'sent',http:200,error:null}]})};
  }
  return{ok:false,json:async()=>({error:'unknown'})};
 };
 const context={window,document,fetch,setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{tick=null;},Number,Error};
 vm.runInNewContext(await readFile(new URL('../public/simulator.js',import.meta.url),'utf8'),context);
 await new Promise(r=>setImmediate(r));
 assert.equal(calls[0].url,'/api/status');
 document.getElementById('simulationPhone').value='87788328909';
 document.getElementById('simulationCount').value='2';
 Object.defineProperty(document.getElementById('simulationChannel'),'value',{value:'both'});
 await document.getElementById('simulationForm').onsubmit({preventDefault(){}});
 const dispatch=calls.find(c=>c.url==='/api/dispatch');assert.ok(dispatch);assert.equal(JSON.parse(dispatch.opts.body).simulation,true);assert.equal(JSON.parse(dispatch.opts.body).phone,'87788328909');
 assert.ok(tick);
 await tick();
 await tick();
 assert.equal(document.querySelectorAll('#simulationLog li').length,2);
 assert.match(document.querySelector('#simulationLog li').textContent,/ep1/);
 assert.match(document.getElementById('simulationSummary').textContent,/отправлено: 2 \/ 2/);
 document.getElementById('simulationClear').onclick();
 assert.equal(document.querySelectorAll('#simulationLog li').length,0);
});
