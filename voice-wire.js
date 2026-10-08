import {createHash,createDecipheriv} from 'node:crypto';

// This is the public registration transport key bundled in Nekto's client,
// not a user's credential. Session-key encrypted chat frames are never read.
const registrationKey=createHash('sha256').update('e723938b821ede7337fbe5e642693d1d9474d5bedfdcd01039693e38d424fc72').digest();
function registrationPayload(data){
 if(data._==null||data._===0)return data;
 if(data._!==2||typeof data.i!=='string'||typeof data.s!=='string')return null;
 try{
  const iv=Buffer.from(data.i,'base64'),bytes=Buffer.from(data.s,'base64');
  if(iv.length!==12||bytes.length<16)return null;
  const decipher=createDecipheriv('aes-256-gcm',registrationKey,iv);
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0,-16)),decipher.final()]).toString('utf8'));
 }catch{return null;}
}

// Read a narrow set of native Socket.IO events. Return booleans and fixed
// labels only; credentials, identities and chat payloads never leave here.
export function voiceWireFrame(direction,payload,expectedToken){
 if(typeof payload!=='string'||payload.length>65536)return null;
 const match=/^42(?:\/[^,]*,)?(?:\d+)?(\[.*)$/s.exec(payload);
 if(!match)return null;
 let packet;try{packet=JSON.parse(match[1]);}catch{return null;}
 if(!Array.isArray(packet)||!packet[1]||typeof packet[1]!=='object')return null;
 const [event,body]=packet;
 if(direction==='sent'&&event==='event'){
  const data=registrationPayload(body);
  if(data?.type==='register')return {registrationSent:true,sentTokenMatches:typeof expectedToken==='string'&&data.userId===expectedToken};
 }
 if(direction==='received'&&(event==='registered'||event==='event')){
  const data=registrationPayload(body);
  if(data&&(event==='registered'||data.type==='registered'))return {registrationReceived:true,registrationSucceeded:data.success===true,registrationError:Number.isSafeInteger(Number(data.errorCode))?Number(data.errorCode):null};
 }
 if(direction==='received'&&['captcha-request','hcaptcha-request','ban'].includes(event))return {lastResult:event};
 return null;
}
