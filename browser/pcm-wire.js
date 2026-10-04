// Normalize cross-world PCM to bounded binary blocks; legacy arrays remain supported.
function pcmBuffer(value){
 try{
  let samples;
  if(Array.isArray(value)){if(!value.length||value.length>4096||!value.every(Number.isFinite))return null;samples=Float32Array.from(value);}
  else if(Object.prototype.toString.call(value)==='[object ArrayBuffer]'){
   if(!value.byteLength||value.byteLength>16384||value.byteLength%4)return null;
   samples=new Float32Array(value);if(samples.byteLength!==value.byteLength)return null;
  }else if(ArrayBuffer.isView(value)&&['[object Float32Array]','[object Uint8Array]'].includes(Object.prototype.toString.call(value))){
   if(!value.byteLength||value.byteLength>16384||value.byteLength%4)return null;samples=new Float32Array(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));
  }else return null;
  for(const n of samples)if(!Number.isFinite(n))return null;
  return samples.buffer;
 }catch{return null;}
}
module.exports={pcmBuffer};
