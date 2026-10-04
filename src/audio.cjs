'use strict';
const {Readable}=require('node:stream'),{performance}=require('node:perf_hooks');
const FRAME=960; // 20 ms at 48 kHz
class Queue {
 constructor(capacity=FRAME*12,target=FRAME*2){this.ring=new Float32Array(capacity);this.target=target;this.clear();}
 clear(){this.read=0;this.write=0;this.size=0;this.primed=false;this.fraction=0;this.dropped=0;}
 push(samples){for(const value of samples){if(this.size===this.ring.length){this.read=(this.read+1)%this.ring.length;this.size--;this.dropped++;}this.ring[this.write]=Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0;this.write=(this.write+1)%this.ring.length;this.size++;}}
 take(count=FRAME){const result=new Float32Array(count);if(!this.primed&&this.size>=this.target)this.primed=true;if(!this.primed)return result;const rate=1+Math.max(-.003,Math.min(.003,(this.size-this.target)/this.target*.003));for(let i=0;i<count;i++){if(this.size<2){this.primed=false;this.fraction=0;break;}const next=(this.read+1)%this.ring.length;result[i]=this.ring[this.read]+(this.ring[next]-this.ring[this.read])*this.fraction;this.fraction+=rate;const n=Math.floor(this.fraction);this.fraction-=n;this.read=(this.read+n)%this.ring.length;this.size-=n;}return result;}
}
function decodeStereo(bytes){if(!Buffer.isBuffer(bytes)||bytes.length%4)throw Error('Expected interleaved s16le stereo PCM');const out=new Float32Array(bytes.length/4);for(let i=0;i<out.length;i++)out[i]=(bytes.readInt16LE(i*4)+bytes.readInt16LE(i*4+2))/65536;return out;}
function encodeStereo(samples){const out=Buffer.alloc(samples.length*4);samples.forEach((v,i)=>{const n=Math.round(Math.max(-1,Math.min(1,Number.isFinite(v)?v:0))*32767);out.writeInt16LE(n,i*4);out.writeInt16LE(n,i*4+2);});return out;}
function sum(...sources){const out=new Float32Array(FRAME);for(const src of sources)for(let i=0;i<out.length;i++)out[i]+=src[i]||0;for(let i=0;i<out.length;i++)out[i]=Math.max(-.95,Math.min(.95,out[i]));return out;}
function rms(samples){return Math.sqrt(samples.reduce((s,n)=>s+n*n,0)/samples.length)||0;}
class Mixer {
 constructor(){this.remote=[new Queue(),new Queue()];this.users=new Map();this.active=[false,false];this.enabled=false;this.muted=false;this.metrics={discordIn:0,nektoIn:[0,0],levels:{discord:0,nekto:[0,0]}};}
 activate(i,value){this.active[i]=value;this.remote[i].clear();}
 pushRemote(i,samples){if(this.enabled&&this.active[i]){this.remote[i].push(samples);this.metrics.nektoIn[i]++;}}
 pushUser(id,bytes){if(!this.enabled)return;let q=this.users.get(id);if(!q){q=new Queue();this.users.set(id,q);}q.push(decodeStereo(bytes));this.metrics.discordIn++;}
 clear(){this.remote.forEach(q=>q.clear());this.users.clear();}
 frame(){const remote=this.remote.map((q,i)=>this.enabled&&this.active[i]?q.take():new Float32Array(FRAME));const people=[...this.users.values()].map(q=>q.take());const humans=this.enabled&&!this.muted?sum(...people):new Float32Array(FRAME);const toDiscord=this.enabled?sum(...remote):new Float32Array(FRAME);const toNekto=remote.map((_r,i)=>this.enabled&&this.active[i]?sum(humans,remote[1-i]):new Float32Array(FRAME));this.metrics.levels={discord:rms(toDiscord),nekto:toNekto.map(rms)};return {toDiscord,toNekto};}
}
// Pace the upstream PCM clock explicitly: Opus transforms can prefetch many
// frames even when the downstream Discord player consumes only one per 20 ms.
class LivePCM extends Readable {
 constructor(mixer,onFrame){super({highWaterMark:FRAME*4});this.mixer=mixer;this.onFrame=onFrame;this.nextAt=performance.now();this.timer=null;}
 _read(){if(this.timer||this.destroyed)return;this.timer=setTimeout(()=>{this.timer=null;if(this.destroyed)return;const now=performance.now();this.nextAt+=20;if(this.nextAt<now)this.nextAt=now+20;try{const frame=this.mixer.frame();this.onFrame(frame.toNekto);this.push(encodeStereo(frame.toDiscord));}catch(error){this.destroy(error);}},Math.max(0,this.nextAt-performance.now()));}
 _destroy(error,callback){clearTimeout(this.timer);this.timer=null;callback(error);}
}
module.exports={Queue,Mixer,LivePCM,decodeStereo,encodeStereo,sum,rms,FRAME};
