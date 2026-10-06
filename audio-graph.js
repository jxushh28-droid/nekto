import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const execute=promisify(execFile);
export class AudioGraph{
 constructor(){this.process=null;this.ready=null;this.directory=null;this.loops=[];this.inputs=[];this.routeKey=null;this.chain=Promise.resolve();}
 async pactl(...args){const {stdout}=await execute('pactl',args,{env:this.env,timeout:5000,maxBuffer:1024*1024});return stdout.trim();}
 async ensure(){if(this.ready)return this.ready;this.ready=this.initialize().catch(async()=>{await this.close();throw Error('Audio devices could not start. Check the server audio service.');});return this.ready;}
 async initialize(){this.directory=await mkdtemp(join(tmpdir(),'nekto-audio-'));const socket=join(this.directory,'native');this.env={...process.env,PULSE_SERVER:'unix:'+socket};let failed=false;
  this.process=spawn('pulseaudio',['-n','--daemonize=no','--exit-idle-time=-1','--use-pid-file=no','--log-level=error','--load=module-native-protocol-unix socket='+socket+' auth-anonymous=no'],{env:this.env,stdio:['ignore','ignore','ignore']});this.process.on('error',()=>failed=true);const daemon=this.process;this.process.on('exit',()=>{failed=true;if(this.process===daemon){this.process=null;this.ready=null;this.routeKey=null;}});
  let connected=false;for(let n=0;n<40&&!failed;n++){try{await this.pactl('info');connected=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}if(!connected)throw Error('Audio service unavailable');
  for(const letter of ['A','B']){for(const kind of ['output','input'])await this.pactl('load-module','module-null-sink','sink_name=nekto_'+kind+'_'+letter,'rate=48000','channels=1','sink_properties=device.description=Nekto_'+kind+'_'+letter);await this.pactl('load-module','module-remap-source','source_name=nekto_mic_'+letter,'master=nekto_input_'+letter+'.monitor','channels=1','source_properties=device.description=Nekto_mic_'+letter);}
  for(const [from,to] of [['A','B'],['B','A']])this.loops.push(Number(await this.pactl('load-module','module-loopback','source=nekto_output_'+from+'.monitor','sink=nekto_input_'+to,'latency_msec=40','source_dont_move=true','sink_dont_move=true')));
  const inputs=JSON.parse(await this.pactl('-f','json','list','sink-inputs'));this.inputs=this.loops.map(id=>inputs.find(input=>Number(input.owner_module)===id)?.index);if(this.inputs.some(i=>i==null))throw Error('Audio routing unavailable');this.routeKey=null;await this.routing(false);return this;
 }
 browserEnv(i){const l=i?'B':'A';return {...this.env,PULSE_SINK:'nekto_output_'+l,PULSE_SOURCE:'nekto_mic_'+l};}
 routing(enabled){this.chain=this.chain.catch(()=>{}).then(async()=>{if(this.routeKey===enabled)return;for(const id of this.inputs)await this.pactl('set-sink-input-mute',String(id),enabled?'0':'1');this.routeKey=enabled;});return this.chain;}
 capture(i){return spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','pulse','-i','nekto_output_'+(i?'B':'A')+'.monitor','-ac','1','-ar','24000','-f','s16le','pipe:1'],{env:this.env,stdio:['ignore','pipe','ignore']});}
 async close(){this.process?.kill('SIGTERM');this.process=null;this.ready=null;this.inputs=[];this.loops=[];this.routeKey=null;if(this.directory)await rm(this.directory,{recursive:true,force:true}).catch(()=>{});this.directory=null;}
}
