// Self-contained so the browser can install the same runtime in each page world.
function installPCMRuntime(source){
 if(window.__neonPCMRuntime)return window.__neonPCMRuntime;
 class Ring {
  constructor(){this.data=new Float32Array(16384);this.r=0;this.w=0;this.size=0;this.fraction=0;this.primed=false;this.last=0;this.fade=0;this.target=2048;}
  push(samples){if(samples?.clear){this.size=0;this.r=this.w;this.fraction=0;this.primed=false;this.target=2048;return;}if(!samples?.length)return;for(const sample of samples){if(this.size===this.data.length){this.r=(this.r+1)%this.data.length;this.size--;this.fade=128;}this.data[this.w]=Number.isFinite(sample)?Math.max(-1,Math.min(1,sample)):0;this.w=(this.w+1)%this.data.length;this.size++;}}
  read(out){out.fill(0);if(!this.primed&&this.size>=this.target){this.primed=true;this.fade=128;}const rate=1+Math.max(-.003,Math.min(.003,(this.size-this.target)/this.target*.003));for(let i=0;i<out.length;i++){if(!this.primed||this.size<2){if(this.primed)this.target=Math.min(4096,this.target+512);this.primed=false;this.fraction=0;this.last*=.94;out[i]=this.last;continue;}let sample=this.data[this.r]+(this.data[(this.r+1)%this.data.length]-this.data[this.r])*this.fraction;if(this.fade>0){sample=this.last+(sample-this.last)*.08;this.fade--;}out[i]=sample;this.last=sample;this.fraction+=rate;const n=Math.floor(this.fraction);this.fraction-=n;this.r=(this.r+n)%this.data.length;this.size-=n;}}
 }
 const initialized=new WeakMap();
 async function initialize(ctx,primaryURL){
  if(initialized.has(ctx))return initialized.get(ctx);
  const pending=(async()=>{
   let mode='compatible',reason='';
   if(ctx.audioWorklet&&typeof AudioWorkletNode==='function'){
    const urls=[];if(primaryURL)urls.push(primaryURL);
    const blobURL=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));urls.push(blobURL);
    try{
     for(const url of urls){let timer;try{await Promise.race([ctx.audioWorklet.addModule(url,{credentials:'omit'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Audio module load timed out')),1000);})]);const probe=new AudioWorkletNode(ctx,'neon-playback',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});probe.port.close();probe.disconnect();mode='worklet';break;}catch(error){reason=error.name+': '+error.message;}finally{clearTimeout(timer);}}
    }finally{URL.revokeObjectURL(blobURL);}
   }else reason='AudioWorklet unavailable';
   if(mode==='compatible'&&typeof ctx.createScriptProcessor!=='function')throw Error('Both audio processing methods are unavailable: '+reason);
   return {mode,reason:mode==='compatible'?reason:'',
    capture(){
     if(mode==='worklet')return new AudioWorkletNode(ctx,'neon-capture');
     const node=ctx.createScriptProcessor(1024,2,1);node.port={onmessage:null,close(){node.onaudioprocess=null;}};
     node.onaudioprocess=event=>{const buffer=event.inputBuffer,samples=new Float32Array(buffer.length);for(let c=0;c<buffer.numberOfChannels;c++){const channel=buffer.getChannelData(c);for(let i=0;i<samples.length;i++)samples[i]+=channel[i]/buffer.numberOfChannels;}event.outputBuffer.getChannelData(0).fill(0);node.port.onmessage?.({data:samples});};return node;
    },
    playback(){
     if(mode==='worklet')return new AudioWorkletNode(ctx,'neon-playback',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
     const node=ctx.createScriptProcessor(1024,0,1),ring=new Ring();node.port={postMessage:samples=>ring.push(samples),close(){node.onaudioprocess=null;}};node.onaudioprocess=event=>ring.read(event.outputBuffer.getChannelData(0));return node;
    }
   };
  })();initialized.set(ctx,pending);try{return await pending;}catch(error){initialized.delete(ctx);throw error;}
 }
 window.__neonPCMRuntime={initialize};return window.__neonPCMRuntime;
}
if(typeof module!=='undefined')module.exports={installPCMRuntime};else window.installPCMRuntime=installPCMRuntime;
