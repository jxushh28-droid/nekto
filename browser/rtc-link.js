// Discover existing native peer objects without changing constructors/prototypes.
const pending=new WeakMap(),lastDiscovery=new WeakMap();
function linkCallAudio(wc,force=false){if(pending.has(wc))return force?pending.get(wc).then(()=>linkCallAudio(wc,true)):pending.get(wc);const task=discoverCallAudio(wc,force);pending.set(wc,task);task.then(()=>pending.delete(wc),()=>pending.delete(wc));return task;}
async function discoverCallAudio(wc,force){
 if(!wc.debugger.isAttached())wc.debugger.attach('1.3');
 const group='neon-call-audio';
 try{
  if(!force&&Date.now()-(lastDiscovery.get(wc)||0)<6000){
   const result=await wc.debugger.sendCommand('Runtime.evaluate',{expression:'window.__neonBridge.attachSenders()',awaitPromise:true,returnByValue:true});
   if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result?.value;
  }
  lastDiscovery.set(wc,Date.now());
  const prototype=await wc.debugger.sendCommand('Runtime.evaluate',{expression:'RTCPeerConnection.prototype',objectGroup:group});
  if(!prototype.result?.objectId)throw Error('Call audio API is unavailable.');
  const objects=await wc.debugger.sendCommand('Runtime.queryObjects',{prototypeObjectId:prototype.result.objectId,objectGroup:group});
  const result=await wc.debugger.sendCommand('Runtime.callFunctionOn',{objectId:objects.objects.objectId,functionDeclaration:'function(){return window.__neonBridge.attachSenders(this);}',awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result?.value;
 }finally{await wc.debugger.sendCommand('Runtime.releaseObjectGroup',{objectGroup:group}).catch(()=>{});}
}
module.exports={linkCallAudio};
