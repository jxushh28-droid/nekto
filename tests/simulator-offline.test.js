import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('server forces offline events even when a caller requests live mode and provides proxies',async()=>{
 const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
 const fire=source.slice(source.indexOf('async function fireEndpoint('),source.indexOf('\nconst bomberJobs='));
 const run=source.slice(source.indexOf('async function runBomberJob('),source.indexOf('\nfunction snapshotBomberJob('));
 assert.ok(fire&&run);
 for(const requestedSimulation of [false,true]){
  const jobs=new Map();let networkCalls=0,proxyConstructions=0;
  const sandbox={bomberJobs:jobs,pruneBomberJobs(){},normalizeKzPhone:()=>({e164:'+77788328909',national:'7788328909',valid:true}),loadBomberConfig:async()=>({simulation:false,endpoints:[{name:'offline fixture',channel:'sms',url:'https://example.invalid/'}],threads:1,proxies:[],userAgents:['fixture'],delayMinMs:0,delayMaxMs:0}),randOf:xs=>xs[0],randDelay:()=>0,setTimeout:fn=>setTimeout(fn,0),uFetch(){networkCalls++;throw Error('No live requests allowed');},ProxyAgent:class{constructor(){proxyConstructions++;throw Error('No proxy connections allowed');}}};
  vm.createContext(sandbox);vm.runInContext(fire+'\n'+run+'\nglobalThis.runOfflineJob=runBomberJob;',sandbox);
  const result=await sandbox.runOfflineJob('87788328909',2,'sms',requestedSimulation,['http://example.invalid:1234']);
  const job=jobs.get(result.id);
  for(let n=0;n<100&&!job.done;n++)await new Promise(r=>setTimeout(r,5));
  assert.equal(job.done,true);assert.equal(job.cfg.simulation,true);assert.equal(job.sent,2);assert.equal(job.failed,0);assert.equal(networkCalls,0);assert.equal(proxyConstructions,0);
 }
});
