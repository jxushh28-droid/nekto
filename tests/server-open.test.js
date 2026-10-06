import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {withToken,ORIGIN} from '../session.js';
const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
const openSource=source.slice(source.indexOf('async function open(i){'),source.indexOf('\nfunction operationError'));
function fixture(tokens){
 const slots=[null,null],states=[],visits=[],tokenStatus=[false,false];
 const page={on(){},async goto(url){visits.push(url);}};
 const context={async addInitScript(){},async newPage(){return page;},async storageState(){},async close(){}};
 const sandbox={audio:{hasOpen:()=>false},slots,configuredTokens:tokens,tokenStatus,withToken,data:'/fixture',injection:'',site:ORIGIN+'/chat/',readFile:async()=>{throw Object.assign(new Error('not found'),{code:'ENOENT'});},getBrowser:async()=>({async newContext(options){states.push(options.storageState);return context;}}),operationError(){}};
 vm.createContext(sandbox);vm.runInContext(openSource+';globalThis.openSlot=open;',sandbox);
 return {slots,states,visits,open:sandbox.openSlot};
}
test('both fresh sessions open with configured tokens before authorization',async()=>{const f=fixture(['first-token','second-token']);await f.open(0);await f.open(1);assert.equal(f.visits.length,2);for(let i=0;i<2;i++){const storage=f.states[i].origins.find(o=>o.origin===ORIGIN).localStorage.find(x=>x.name==='storage_v2');assert.equal(JSON.parse(storage.value).user.authToken,i===0?'first-token':'second-token');assert.equal(f.slots[i].opening,false);assert.equal(f.slots[i].preparedToken,null);}await f.open(0);assert.equal(f.visits.length,2);});
test('opening without configured credentials still works',async()=>{const f=fixture([null,null]);await f.open(0);assert.equal(f.visits.length,1);assert.equal(f.states[0],undefined);});
test('audio screen endpoint requires panel authentication and returns no image for a closed session',async()=>{
 const {spawn}=await import('node:child_process'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createServer}=await import('node:net');
 const temporary=await mkdtemp(join(tmpdir(),'screen-auth-')),probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DASHBOARD_PASSWORD:'fixture-screen-panel-password',TEXT_DATA_DIR:temporary,NODE_ENV:'test'},stdio:'ignore'});
 try{
  const base='http://127.0.0.1:'+port;let ready=false;for(let n=0;n<100;n++){try{ready=(await fetch(base+'/health')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,50));}assert.equal(ready,true);
  assert.equal((await fetch(base+'/api/audio/0/screen')).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'fixture-screen-panel-password'})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0],response=await fetch(base+'/api/audio/0/screen',{headers:{Cookie:cookie}});assert.equal(response.status,204);assert.equal(await response.text(),'');assert.equal(response.headers.get('cache-control'),'no-store');
 }finally{
  const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;await rm(temporary,{recursive:true,force:true});
 }
});
