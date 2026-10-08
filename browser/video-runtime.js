(()=>{
 if(!['ometv.chat','yap.chat','127.0.0.1'].includes(location.hostname))return;
 const yap=location.hostname==='yap.chat'||window.__videoHostConfig?.provider==='yap';
 if(location.hostname==='yap.chat'&&location.pathname!=='/video')return;
 if(location.hostname==='ometv.chat'&&location.pathname!=='/embed/index.html')return;
 if(window.__videoHost||!navigator.mediaDevices||!window.MediaRecorder||!window.MediaSource)return;
 const NativeRTC=window.RTCPeerConnection;const width=window.__videoHostConfig?.width===320?320:640,height=width*9/16,fps=width===320?10:15;
 const audio=new AudioContext(),outAudio=audio.createMediaStreamDestination(),remoteAudio=audio.createMediaStreamDestination();
 const outgoing=document.createElement('canvas'),preview=document.createElement('canvas');for(const c of [outgoing,preview]){c.width=width;c.height=height;}
 const outCtx=outgoing.getContext('2d'),previewCtx=preview.getContext('2d');
 const outVideo=outgoing.captureStream(fps),previewVideo=preview.captureStream(fps);
 const virtual=new MediaStream([...outVideo.getVideoTracks(),...outAudio.stream.getAudioTracks()]);
 const previewStream=new MediaStream([...previewVideo.getVideoTracks(),...remoteAudio.stream.getAudioTracks()]);
 const incoming=document.createElement('video');incoming.autoplay=true;incoming.playsInline=true;incoming.muted=false;incoming.volume=1;incoming.style.cssText='position:fixed;left:-10000px;width:1px;height:1px';
 const player=new VideoStreamPlayer(incoming),incomingSource=audio.createMediaElementSource(incoming),gain=audio.createGain();gain.gain.value=0;incomingSource.connect(gain).connect(outAudio);const meter=audio.createAnalyser();meter.fftSize=2048;gain.connect(meter);
 let previewRequested=false,enabled=false,otherConnected=false,remote=null,remotePeer=null,remoteSource=null,recorder=null,generation=0,documentId=crypto.randomUUID(),recordTimer=null,disconnectTimer=null,remoteWasConnected=false,ended=false,disposed=false,fixture=null,cameraCalls=0,yapMatchRoom=null;
 const peers=new Set();
 const mount=()=>{if(document.body&&!incoming.isConnected)document.body.append(incoming);};document.addEventListener('DOMContentLoaded',mount);mount();
 navigator.mediaDevices.getUserMedia=async constraints=>{cameraCalls++;if(disposed)throw new DOMException('Session closed','AbortError');await audio.resume();const tracks=[];if(constraints.video)tracks.push(...virtual.getVideoTracks().map(t=>t.clone()));if(constraints.audio)tracks.push(...virtual.getAudioTracks().map(t=>t.clone()));if(!tracks.length)throw new TypeError('Audio or video is required');return new MediaStream(tracks);};
 function siteRemoteVideo(){return yap?[...document.querySelectorAll('video')].find(v=>v!==incoming&&v.srcObject&&v.srcObject===remote):document.getElementById('remote-video');}
 function peerLive(p){return p.connectionState==='connected'||['connected','completed'].includes(p.iceConnectionState);}
 function connected(){const view=siteRemoteVideo();const tracks=remote?.getTracks()||[];const mediaReady=yap&&!fixture?['audio','video'].every(kind=>tracks.some(t=>t.kind===kind&&t.readyState==='live'))&&view?.readyState>=2:tracks.some(t=>t.readyState==='live');const live=!ended&&!!remote&&mediaReady&&(remotePeer?peerLive(remotePeer):[...peers].some(peerLive)||!!fixture||(!peers.size&&view?.srcObject===remote&&view.readyState>=2&&!view.paused));if(live)remoteWasConnected=true;return live;}
 function stopRecording(){clearTimeout(recordTimer);if(recorder?.state==='recording')recorder.stop();recorder=null;}
 function startRecording(){stopRecording();if(!connected()||disposed||!fixture&&!previewRequested&&!(enabled&&otherConnected))return;const id=documentId+':'+(++generation);const r=recorder=new MediaRecorder(previewStream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:width===320?200000:600000,audioBitsPerSecond:64000});let chain=Promise.resolve();r.ondataavailable=e=>{if(!e.data.size)return;chain=chain.then(async()=>{const bytes=new Uint8Array(await e.data.arrayBuffer());let text='';for(let i=0;i<bytes.length;i++)text+=String.fromCharCode(bytes[i]);if(!disposed)await window.__videoSegment?.({generation:id,data:btoa(text)});}).catch(()=>{});};r.start(250);recordTimer=setTimeout(startRecording,25000);}
 function setRemote(stream,peer=remotePeer){if(stream&&peer!==remotePeer){clearTimeout(disconnectTimer);disconnectTimer=null;}if(stream)remotePeer=peer;else remotePeer=null;if(remote===stream&&(!stream?.getAudioTracks().length||remoteSource))return;if(remoteSource){remoteSource.disconnect();remoteSource=null;}remote=stream;if(stream?.getAudioTracks().length){remoteSource=audio.createMediaStreamSource(stream);remoteSource.connect(remoteAudio);}if(stream)startRecording();else stopRecording();}
 if(NativeRTC){const WrappedRTC=class extends NativeRTC{constructor(...args){super(...args);peers.add(this);this.addEventListener('track',e=>{if(!remoteWasConnected)ended=false;if(e.streams?.[0])setRemote(e.streams[0],this);else if(e.track){const stream=remotePeer===this&&remote||new MediaStream();if(!stream.getTracks().includes(e.track))stream.addTrack(e.track);setRemote(stream,this);}});const changed=()=>{
  if(this.connectionState==='closed'||this.iceConnectionState==='closed')peers.delete(this);
  if(remotePeer&&remotePeer!==this)return;
  if(peerLive(this)){clearTimeout(disconnectTimer);disconnectTimer=null;if(!recorder)startRecording();return;}
  if(['closed','failed','disconnected'].includes(this.connectionState)||['closed','failed','disconnected'].includes(this.iceConnectionState)){
   gain.gain.value=0;stopRecording();
   const finish=()=>{disconnectTimer=null;if(disposed||remotePeer!==this||peerLive(this))return;if(remoteWasConnected)ended=true;setRemote(null);};
   // ICE can recover in the same room. Mute during the outage but retain the
   // stream until recovery or a bounded timeout. Native room changes still end immediately.
   if(yap&&!['closed'].includes(this.connectionState)&&this.iceConnectionState!=='closed'){if(!disconnectTimer)disconnectTimer=setTimeout(finish,4000);}
   else finish();
  }
 };this.addEventListener('connectionstatechange',changed);this.addEventListener('iceconnectionstatechange',changed);}};window.RTCPeerConnection=WrappedRTC;if(window.webkitRTCPeerConnection===NativeRTC)window.webkitRTCPeerConnection=WrappedRTC;}
 function draw(ctx,video){ctx.fillStyle='#000000';ctx.fillRect(0,0,width,height);if(video?.readyState>=2)ctx.drawImage(video,0,0,width,height);}
 function yapNativeProps(){
  const roots=new Set(),fallback=[];
  for(const element of document.querySelectorAll('button,video')){
   const key=Object.keys(element).find(k=>k.startsWith('__reactFiber$'));let fiber=element[key];
   for(let depth=0;fiber&&depth<80;depth++,fiber=fiber.return){
    if(fiber.stateNode?.current)roots.add(fiber.stateNode.current);
    const props=fiber.memoizedProps;
    if(typeof props?.onStart==='function'&&['idle','searching','connecting','inCall','stopped'].includes(props.status))fallback.push(props);
   }
  }
  // A DOM node can retain a fiber from the previous render. Read the committed
  // root's tree, rather than trusting that stale node's return pointers.
  for(const root of roots){
   const pending=[root],seen=new Set();
   while(pending.length&&seen.size<10000){
    const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;seen.add(fiber);
    const props=fiber.memoizedProps;
    if(typeof props?.onStart==='function'&&['idle','searching','connecting','inCall','stopped'].includes(props.status))return props;
    if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
   }
  }
  // Rootless fixtures and older renderers remain observable. Never fall back
  // to an uncommitted branch when a real React root is present.
  return roots.size?null:fallback[0]||null;
 }
 function yapClientState(){
  // Read only the native chat component's existing public state. Never copy
  // its socket, user identity, messages or authentication data into diagnostics.
  const props=yapNativeProps();
  if(props){
    // The room boundary stays inside the page. If Yap replaces a participant
    // between polls, mute immediately and let the host close this side.
    const room=props.currentMatch?.type==='user'&&typeof props.currentMatch.roomId==='string'?props.currentMatch.roomId:null;
    if(room){if(!remoteWasConnected||!yapMatchRoom)yapMatchRoom=room;else if(room!==yapMatchRoom)ended=true;}
    else if(remoteWasConnected&&(props.currentMatch?.type==='bot'||['idle','searching','stopped'].includes(props.status)))ended=true;
    if(ended){gain.gain.value=0;stopRecording();}
    const mode=props.socket?.auth?.mode;
    return {found:true,status:props.status,socketConnected:props.socket?.connected===true,matchKind:props.currentMatch?.type==='user'?'live':props.currentMatch?.type==='bot'?'playback':null,mode:['normal','test','bot-only','adult'].includes(mode)?mode:null};
  }
  return {found:false,status:null,socketConnected:false,matchKind:null,mode:null};
 }
 const remoteView=document.createElement('video');remoteView.autoplay=true;remoteView.muted=true;remoteView.playsInline=true;
 const renderTimer=setInterval(()=>{mount();if(yap&&!ended)yapClientState();if(fixture){const ctx=fixture.canvas.getContext('2d');ctx.fillStyle=fixture.color;ctx.fillRect(0,0,640,360);}const siteVideo=siteRemoteVideo();if(!fixture&&siteVideo?.srcObject&&siteVideo.srcObject!==remote)setRemote(siteVideo.srcObject);const needPreview=!!fixture||previewRequested||(enabled&&otherConnected),nativePreview=siteVideo?.srcObject===remote&&siteVideo.readyState>=2;const fallback=needPreview&&!nativePreview?remote:null;if(remoteView.srcObject!==fallback){remoteView.srcObject=fallback;if(fallback)remoteView.play().catch(()=>{});}const live=connected();if(live)remoteWasConnected=true;gain.gain.value=enabled&&otherConnected&&live?1:0;if(needPreview)draw(previewCtx,live?(nativePreview?siteVideo:remoteView):null);draw(outCtx,enabled&&otherConnected&&live?incoming:null);},1000/fps);
 window.__videoHost={
  status(){
   const visible=el=>{if(el.closest('[hidden],[aria-hidden="true"],[inert]'))return false;if(el.checkVisibility&&!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;const rect=el.getBoundingClientRect();if(!rect.width||!rect.height||rect.bottom<=0||rect.right<=0||rect.top>=innerHeight||rect.left>=innerWidth)return false;for(let node=el;node instanceof Element;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;}return true;};
   if(yap){
    const native=yapClientState();
    const texts=[...document.querySelectorAll('button,[role="alert"],[role="dialog"],[role="status"],[aria-live],h1,h2,h3,p,span,div')].filter(visible).filter(e=>!e.children.length||e.matches('button,[role="alert"],[role="dialog"],[role="status"],[aria-live],h1,h2,h3,p')).map(e=>(e.innerText||'').replace(/\s+/g,' ').trim()).filter(t=>t&&t.length<=300);
    const verification=texts.some(t=>/verify (?:that )?you are human|checking your browser|unusual traffic|complete (?:the )?captcha/i.test(t));
    const restricted=texts.some(t=>/^(?:you (?:are|have been) (?:banned|blocked)|your (?:access|session|ip(?: address)?) (?:is|has been) (?:blocked|banned|restricted)|access denied)/i.test(t));
    const cameraError=texts.some(t=>/^(?:camera access denied|microphone access denied|unable to access (?:camera|microphone)|permission denied|camera(?:\/| and )microphone permissions are required|camera and microphone are blocked|your camera isn't working)/i.test(t));
    const login=texts.some(t=>/^(?:login required|sign in first|please (?:log ?in|sign in) (?:with Google )?to start|you (?:need|must) (?:log ?in|sign in) (?:first|to start))/i.test(t));
    const mode=native.mode||({matches:'bot-only',user:'test',test:'test'}[new URL(location.href).searchParams.get('mode')]||'normal');
    const playbackWaiting=native.matchKind==='playback'&&mode!=='bot-only';
    const nativeError=restricted?'Yap has restricted this session.':cameraError?'Yap could not access the hosted camera or microphone.':mode==='bot-only'?'Yap selected playback-only matching for this browser. A live participant is required for the bridge.':'';
    const message=[...document.querySelectorAll('textarea,input[type="text"]')].some(e=>!e.disabled&&visible(e));
    let selfGender=null;try{const value=localStorage.getItem('uhmingle_selected_gender');if(value==='male'||value==='female')selfGender=value;}catch{}
    const genderRequired=!selfGender&&texts.some(t=>/^(?:Who are you\?|Pick your gender to start matching\.)$/i.test(t));
    const local=[...document.querySelectorAll('video')].find(v=>v!==incoming&&v!==siteRemoteVideo()&&v.srcObject?.getTracks?.().length);
    const localVideo={ready:local?.readyState||0,paused:local?.paused??true,tracks:local?.srcObject?.getTracks?.().map(t=>({kind:t.kind,state:t.readyState}))||[]};
    const nativeMediaReady=['audio','video'].every(kind=>localVideo.tracks.some(t=>t.kind===kind&&t.state==='live'));
    return {connected:connected(),ended,searching:['searching','connecting'].includes(native.status)||texts.some(t=>/^(?:searching|finding someone|looking for)(?:\b|…|\.\.\.)/i.test(t))||peers.size>0&&texts.some(t=>/^connecting(?:\b|…|\.\.\.)/i.test(t)),playbackWaiting,nativeError,login,verification,mediaReady:!disposed,nativeMediaReady,localVideo,selfGender,genderRequired,nativeClientFound:native.found,nativeStatus:native.status,nativeSocketConnected:native.socketConnected,nativeMatchKind:native.matchKind,nativeMode:mode,cameraCalls,streamGeneration:generation,recording:recorder?.state==='recording',canSend:message,audioState:audio.state,receiverFailed:player.failed,bridgeEnabled:enabled&&otherConnected,peerStates:[...peers].map(p=>({connection:p.connectionState,ice:p.iceConnectionState})),remoteTracks:remote?.getTracks().map(t=>({kind:t.kind,state:t.readyState}))||[]};
   }
   const labels=[...document.querySelectorAll('[data-tr]')].filter(visible),texts=labels.map(el=>(el.innerText||'').replace(/\s+/g,' ').trim());
   const restricted=labels.some(el=>el.dataset.tr==='youre-banned')||texts.some(text=>/^(?:you (?:are|have been) banned|your (?:account|access|session|ip(?: address)?) (?:is|has been) (?:banned|blocked|restricted)|access (?:is |has been )?denied|ban expires(?: in|:))/i.test(text));
   const cameraError=texts.some(text=>/^(?:camera (?:was |is )?(?:not found|denied|unavailable)|(?:cannot|could not|unable to) access (?:your |the )?camera|camera access (?:was |is )?denied)/i.test(text));
   const networkError=texts.some(text=>/^(?:connection failed|server (?:is )?unavailable|network error)(?:[.!:]|$)/i.test(text));
   const duplicateSession=/you have opened the application in another window or in another browser/i.test(document.body?.innerText||'');
   const nativeError=duplicateSession?'OmeTV requires a separate active session for each side. This session was closed because it is open in another window or browser.':restricted?'OmeTV has restricted this session.':cameraError?'OmeTV could not access the hosted camera.':networkError?'OmeTV could not connect to its server.':'';
   const controls=['start','stop'].map(key=>{const label=document.querySelector('[data-tr="'+key+'"]'),button=label?.closest('.btn');return {key,present:!!button,classes:button?.className||'',ariaDisabled:button?.getAttribute('aria-disabled'),visible:!!button&&visible(button)};});const local=document.getElementById('local-video');
   return {cameraCalls,controls,localVideo:{ready:local?.readyState||0,paused:local?.paused??true,tracks:local?.srcObject?.getTracks?.().map(t=>({kind:t.kind,state:t.readyState}))||[]},topLevel:window===window.top,nativeSessionMode:!!window.config?.sn,connected:connected(),ended,searching:labels.some(el=>/^(searching|search|looking|connecting)(_|$)/i.test(el.dataset.tr)),nativeError,login:/Become an OmeTV member|Continue with.*Google/.test(document.body?.innerText||''),verification:/verify (?:that )?you are human|checking your browser|unusual traffic/i.test(document.body?.innerText||''),mediaReady:!disposed,audioState:audio.state,streamGeneration:generation,receiverFailed:player.failed,bridgeEnabled:enabled&&otherConnected,noticeKeys:labels.map(el=>el.dataset.tr).filter(key=>/ban|error|camera|search|connect|verif/i.test(key)).map(key=>key.replace(/[^a-z0-9_-]/gi,'').slice(0,80)).slice(0,30),peerStates:[...peers].map(p=>({connection:p.connectionState,ice:p.iceConnectionState})),remoteTracks:remote?.getTracks().map(t=>({kind:t.kind,state:t.readyState}))||[]};
  },
  routing(value){enabled=!!value.enabled;otherConnected=!!value.otherConnected;previewRequested=!!value.preview;if(!enabled||!otherConnected)gain.gain.value=0;if(fixture||previewRequested||(enabled&&otherConnected)){if(!recorder)startRecording();}else stopRecording();},
  receive(segment){player.push(segment);audio.resume().catch(()=>{});},
  clearIncoming(){player.dispose();otherConnected=false;gain.gain.value=0;},
  restart(){startRecording();},
  async send(text){const input=document.getElementById('chat-text');if(!connected()||!input||input.disabled)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));return true;},
  async fixture(color,frequency){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,640,360);const tone=audio.createOscillator(),dest=audio.createMediaStreamDestination();tone.frequency.value=frequency;tone.connect(dest);tone.start();fixture={canvas,tone,dest,color};await audio.resume();const stream=new MediaStream([...canvas.captureStream(15).getTracks(),...dest.stream.getTracks()]);setRemote(stream);startRecording();return true;},
  diagnostics(){const bins=new Uint8Array(meter.frequencyBinCount);meter.getByteFrequencyData(bins);let peak=0;for(let i=3;i<150;i++)if(bins[i]>bins[peak])peak=i;return {audioPeak:bins[peak]>20?peak*audio.sampleRate/meter.fftSize:0,outgoingPixel:Array.from(outCtx.getImageData(width/2,height*100/360,1,1).data),incomingReady:incoming.readyState,incomingTime:incoming.currentTime,buffered:player.buffer?.buffered.length||0,receiverFailed:player.failed,...this.status()};},
  dispose(){disposed=true;clearInterval(renderTimer);clearTimeout(disconnectTimer);stopRecording();player.dispose();for(const t of virtual.getTracks())t.stop();for(const t of previewStream.getTracks())t.stop();fixture?.tone.stop();audio.close();}
 };
})();
