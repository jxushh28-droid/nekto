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
