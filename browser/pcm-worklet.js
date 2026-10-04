// Shared host/guest processors; all sample scheduling runs on the audio thread.
function pcmWorkletSource(){return `
class NeonCapture extends AudioWorkletProcessor {
 constructor(){super();this.block=new Float32Array(1024);this.offset=0;}
 process(inputs,outputs){const input=inputs[0];const out=outputs[0]?.[0];if(out)out.fill(0);if(input?.[0])for(let i=0;i<input[0].length;i++){let sample=0;for(const channel of input)sample+=channel[i]||0;this.block[this.offset++]=sample/input.length;if(this.offset===this.block.length){this.port.postMessage(this.block,[this.block.buffer]);this.block=new Float32Array(1024);this.offset=0;}}return true;}
}
class NeonPlayback extends AudioWorkletProcessor {
 constructor(){super();this.ring=new Float32Array(16384);this.write=0;this.read=0;this.size=0;this.fraction=0;this.primed=false;this.last=0;this.fade=0;this.target=2048;this.port.onmessage=event=>{if(event.data?.clear){this.size=0;this.read=this.write;this.fraction=0;this.primed=false;this.target=2048;return;}const data=event.data;if(!data?.length)return;for(let i=0;i<data.length;i++){if(this.size===this.ring.length){this.read=(this.read+1)%this.ring.length;this.size--;this.fade=128;}this.ring[this.write]=Number.isFinite(data[i])?Math.max(-1,Math.min(1,data[i])):0;this.write=(this.write+1)%this.ring.length;this.size++;}};}
 process(inputs,outputs){const out=outputs[0]?.[0];if(!out)return true;out.fill(0);if(!this.primed&&this.size>=this.target){this.primed=true;this.fade=128;}
 const rate=1+Math.max(-.003,Math.min(.003,(this.size-this.target)/this.target*.003));
 for(let i=0;i<out.length;i++){if(!this.primed||this.size<2){if(this.primed){this.target=Math.min(4096,this.target+512);this.primed=false;this.fraction=0;}this.last*=.94;out[i]=this.last;continue;}const first=this.ring[this.read],second=this.ring[(this.read+1)%this.ring.length];let sample=first+(second-first)*this.fraction;if(this.fade>0){sample=this.last+(sample-this.last)*.08;this.fade--;}out[i]=sample;this.last=sample;this.fraction+=rate;const count=Math.floor(this.fraction);this.fraction-=count;this.read=(this.read+count)%this.ring.length;this.size-=count;}
 return true;}
}
registerProcessor('neon-capture',NeonCapture);registerProcessor('neon-playback',NeonPlayback);
`;}
if(typeof module!=='undefined')module.exports={pcmWorkletSource};else window.pcmWorkletSource=pcmWorkletSource;
