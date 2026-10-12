import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';

export async function localFixture(){
 const directory=await mkdtemp(join(tmpdir(),'nekto-local-'));
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
 const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),LOCAL_DASHBOARD_PORT:String(port),LOCAL_EXTENSION_MODE:'1',DASHBOARD_PASSWORD:'',TEXT_DATA_DIR:directory},stdio:['ignore','ignore','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=b);
 const base='http://127.0.0.1:'+port;
 async function stop(){
  if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}
  await rm(directory,{recursive:true,force:true});
 }
 for(let n=0;n<100;n++){
  try{if((await fetch(base+'/health')).ok)return {base,port,stop};}catch{}
  if(child.exitCode!==null)break;
  await new Promise(r=>setTimeout(r,50));
 }
 await stop();throw Error('Local helper did not start: '+errors);
}
