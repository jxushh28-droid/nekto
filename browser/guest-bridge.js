function installBridge(options={},workletSource) {
  // Runs before the site's scripts. This only supports audio WebRTC calls in the main frame.
  if(window.__neonBridge?.installed){window.__neonBridge.restore();return {installed:true};}
  const bridge = window.__neonAudio;
  if(!bridge)throw Error('The Browser audio transport was not installed.');
  const nativeStreamSource=AudioContext.prototype.createMediaStreamSource;
  window.__neonIncomingTracks=new WeakSet();
  const captureMixed=options.bridgeAudio!==false;let mixed=captureMixed;
  let ctx, destination, receiver,outputMeter,processing,remoteBus,remoteTap,remoteSilent;
  let sentFrames=0,receivedFrames=0,micRequests=0;
  const nodes = new Map(),localTracks=new WeakSet(),retiredTracks=new WeakSet();
  let ready;
  function setup() {
    if(ready)return ready;
    ctx=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
    destination=ctx.createMediaStreamDestination();destination.channelCount=1;
    ready=(async()=>{
      processing=await window.__neonPCMRuntime.initialize(ctx,workletSource?null:'neon-audio://processor/pcm.js');
      receiver=processing.playback();receiver.connect(destination);
      outputMeter=ctx.createAnalyser();outputMeter.fftSize=256;
      const silent=ctx.createGain();silent.gain.value=0;receiver.connect(outputMeter);outputMeter.connect(silent);silent.connect(ctx.destination);
      // Sum receivers once, then send one continuous PCM clock to the host.
      remoteBus=ctx.createGain();remoteTap=processing.capture();remoteSilent=ctx.createGain();remoteSilent.gain.value=0;
      remoteTap.port.onmessage=e=>{if(nodes.size){sentFrames++;bridge.send(Array.from(e.data));}};
      remoteBus.connect(remoteTap);remoteTap.connect(remoteSilent);remoteSilent.connect(ctx.destination);
      bridge.receive(samples=>{receivedFrames++;receiver.port.postMessage(new Float32Array(samples));});
      await ctx.resume();
    })();return ready;
  }
  function capture(track) {
    if(track.kind!=='audio'||nodes.has(track.id))return;
    window.__neonIncomingTracks.add(track);
    const node={};nodes.set(track.id,node);
    setup().then(()=>{
      if(nodes.get(track.id)!==node||track.readyState!=='live')return;
      node.source=nativeStreamSource.call(ctx,new MediaStream([track]));
      node.source.connect(remoteBus);
    }).catch(error=>bridge.state({status:'error',error:'Audio processor: '+error.message}));
    track.addEventListener('ended',()=>remove(track.id));
  }
  function remove(id){const node=nodes.get(id);if(!node)return;node.source?.disconnect();nodes.delete(id);}
  if(!navigator.mediaDevices)throw Error('This page does not provide secure media APIs.');
  let connected=false;
  function scan(){
    const elements=[...document.querySelectorAll('audio,video')];
    const localIDs=new Set([...peers].flatMap(peer=>peer.getSenders().map(sender=>sender.track?.id)));
    const retiredIDs=new Set([...peers].filter(peer=>peer.signalingState==='closed'||peer.connectionState==='failed'||peer.connectionState==='disconnected').flatMap(peer=>peer.getReceivers().map(receiver=>receiver.track?.id)));
    const remoteTracks=[...peers].filter(peer=>peer.signalingState!=='closed'&&(peer.connectionState==='connected'||['connected','completed'].includes(peer.iceConnectionState))).flatMap(peer=>peer.getReceivers().map(receiver=>receiver.track));
    const tracks=[...new Map([...elements.flatMap(element=>element.srcObject?.getAudioTracks?.()||[]),...remoteTracks].filter(track=>track?.kind==='audio'&&track.readyState==='live'&&!localIDs.has(track.id)&&!retiredIDs.has(track.id)&&!localTracks.has(track)&&!retiredTracks.has(track)&&!generatedTracks.has(track)).map(track=>[track.id,track])).values()];
    const active=new Set(tracks.map(track=>track.id));
    for(const [id,node] of nodes)if(!active.has(id)){remove(id);}
    tracks.forEach(capture);
    for(const element of elements)if(element.srcObject?.getAudioTracks?.().some(track=>active.has(track.id)))element.muted=true; // Host mixer provides the one audible copy.
    if(connected!==!!tracks.length){connected=!!tracks.length;bridge.state({status:connected?'connected':'ready'});}
  }
  setInterval(scan,100);
  document.addEventListener('play',scan,true);
  const generatedTracks=new WeakSet();
  const mixedMicrophone = async constraints=>{
    if(constraints?.video) throw new DOMException('Neon Bridge supports audio-only calls.','NotSupportedError');
    if(!constraints?.audio) throw new DOMException('Select an audio-only call.','NotSupportedError');
    await setup();await ctx.resume();micRequests++;
    bridge.state({status:'microphone-ready'});
    return new MediaStream([mixedTrack()]);
  };
  function mixedTrack(){
    const track=destination.stream.getAudioTracks()[0].clone();
    generatedTracks.add(track);
    return track;
  }
  function restore(){
    if(captureMixed)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:mixedMicrophone,configurable:true,writable:true});
  }
  const peers=new Set(),replacements=new Map();
  function releasePeer(peer){for(const receiver of peer.getReceivers())if(receiver.track)retiredTracks.add(receiver.track);for(const [sender,item] of replacements)if(item.peer===peer){item.track.stop();replacements.delete(sender);}}
  async function attachSenders(found=[]){
    for(const peer of found)if(peer instanceof RTCPeerConnection&&peer.signalingState!=='closed'){peers.add(peer);for(const sender of peer.getSenders())if(sender.track&&!generatedTracks.has(sender.track))localTracks.add(sender.track);}
    let senders=0,attached=0,muted=0,packets=0,bytes=0;
    if(ctx)await ctx.resume();
    const errors=[],statsErrors=[];
    for(const peer of peers){
      if(peer.signalingState==='closed'){releasePeer(peer);peers.delete(peer);continue;}
      if(peer.connectionState!=='connected'&&!['connected','completed'].includes(peer.iceConnectionState))continue;
      for(const sender of peer.getSenders()){
        if(sender.track?.kind!=='audio')continue;
        const transceiver=peer.getTransceivers().find(item=>item.sender===sender);
        if(transceiver?.currentDirection&&!['sendrecv','sendonly'].includes(transceiver.currentDirection))continue;
        senders++;
        try{
          if(!generatedTracks.has(sender.track)||sender.track.readyState!=='live'){await window.__neonBridge.enable();const track=mixedTrack();track.contentHint='music';try{await sender.replaceTrack(track);const previous=replacements.get(sender);if(previous&&previous.track!==track)previous.track.stop();replacements.set(sender,{peer,track});}catch(error){track.stop();throw error;}}
          if(generatedTracks.has(sender.track)&&sender.track.readyState==='live'){attached++;if(!sender.track.enabled||sender.track.muted||sender.getParameters().encodings?.some(encoding=>encoding.active===false))muted++;}
          let statsTimer;
          try{const stats=await Promise.race([sender.getStats(),new Promise((_,reject)=>{statsTimer=setTimeout(()=>reject(Error('Call sender statistics timed out')),1000);})]);stats.forEach(stat=>{if(stat.type==='outbound-rtp'&&(stat.kind==='audio'||stat.mediaType==='audio')){packets+=stat.packetsSent||0;bytes+=stat.bytesSent||0;}});}catch(error){statsErrors.push(error.message);}finally{clearTimeout(statsTimer);}
        }catch(error){errors.push(error.message);}
      }
    }
    scan();
    return {senders,attached,muted,packets,bytes,contextState:ctx?.state||'uninitialized',statsError:statsErrors.join('; ').slice(0,240),error:errors.join('; ').slice(0,240)};
  }
  window.__neonBridge={installed:true,mixed,captureMixed,enable:async()=>{mixed=true;window.__neonBridge.mixed=true;restore();await setup();await ctx.resume();return true;},restore,isGenerated:track=>generatedTracks.has(track),attachSenders,hasPeers:()=>{for(const peer of peers)if(peer.signalingState==='closed'){releasePeer(peer);peers.delete(peer);}return [...peers].some(peer=>(peer.connectionState==='connected'||['connected','completed'].includes(peer.iceConnectionState))&&peer.getSenders().some(sender=>sender.track?.kind==='audio'));}};
  restore();
  document.addEventListener('click',event=>{if(event.target?.closest?.('#searchCompanyBtn,.callScreen__findBtn'))restore();},true);
  function inputLevel(){if(!outputMeter)return 0;const samples=new Float32Array(outputMeter.fftSize);outputMeter.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length);}
  setInterval(()=>bridge.state({routing:{mixed,incoming:sentFrames,outgoing:receivedFrames,micRequests,inputLevel:inputLevel(),processor:processing?.mode,contextState:ctx?.state||'uninitialized'}}),1000);
  bridge.state({status:'bridge-ready'});
  return {installed:true};
}
async function verifyMicrophone(){
  let timer;
  try{
    if(!window.__neonBridge?.installed)throw Error('Microphone bridge is missing.');
    const permission=await navigator.permissions.query({name:'microphone'});
    if(permission.state!=='granted')throw new DOMException('Website microphone permission is '+permission.state+'.','NotAllowedError');
    const request=navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(stream=>{
      try{const track=stream.getAudioTracks()[0];if(!track||track.readyState!=='live'||(window.__neonBridge.captureMixed&&!window.__neonBridge.isGenerated(track)))throw Error('The page received a different microphone, not the mixed input.');return {ok:true,input:track.label,deviceId:track.getSettings().deviceId,message:window.__neonBridge.captureMixed?'Mixed microphone verified':'Normal startup microphone verified; mix attaches to the live call'};}
      finally{stream.getTracks().forEach(track=>track.stop());}
    });
    return await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Microphone check timed out.')),5000);})]);
  }catch(error){return {ok:false,input:'Unavailable',message:error.name+': '+error.message};}
  finally{clearTimeout(timer);}
}
module.exports = {installBridge,verifyMicrophone};
