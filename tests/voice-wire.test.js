import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {voiceWireFrame} from '../voice-wire.js';

async function nativeEnvelope(data){
 const encoder=new TextEncoder(),iv=webcrypto.getRandomValues(new Uint8Array(12));
 const hash=await webcrypto.subtle.digest('SHA-256',encoder.encode('e723938b821ede7337fbe5e642693d1d9474d5bedfdcd01039693e38d424fc72'));
 const key=await webcrypto.subtle.importKey('raw',hash,{name:'AES-GCM'},false,['encrypt']);
 const encrypted=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(data)));
 return {_:2,i:Buffer.from(iv).toString('base64'),s:Buffer.from(encrypted).toString('base64')};
}
test('native encrypted registration proves the exact sent token and successful reply without returning secrets',async()=>{
 const token='private-token',request='42'+JSON.stringify(['event',await nativeEnvelope({type:'register',userId:token,version:24})]);
 const response='42'+JSON.stringify(['registered',await nativeEnvelope({type:'registered',success:true,internal_id:'private-identity',s:'private-session-key'})]);
 assert.deepEqual(voiceWireFrame('sent',request,token),{registrationSent:true,sentTokenMatches:true});
 assert.deepEqual(voiceWireFrame('sent',request,'different-token'),{registrationSent:true,sentTokenMatches:false});
 const result=voiceWireFrame('received',response,token);
 assert.deepEqual(result,{registrationReceived:true,registrationSucceeded:true,registrationError:null});
 assert.deepEqual(voiceWireFrame('received',response.replace('["registered",','["event",'),token),result);
 assert.doesNotMatch(JSON.stringify(result),/private/);
});
test('wire diagnostics ignore chat frames, binary payloads and unsupported encryption',()=>{
 for(const frame of ['42["message",{"text":"private-message"}]','42["event",{"_":1,"s":"private-session-payload","i":"private-iv"}]','42["event",{"_":2,"s":"invalid","i":"invalid"}]','42["event",null]','garbage',Buffer.from('private-binary')])assert.equal(voiceWireFrame('sent',frame,'private-token'),null);
 assert.deepEqual(voiceWireFrame('received','42["captcha-request",{"secret":"private-value"}]','private-token'),{lastResult:'captcha-request'});
 assert.deepEqual(voiceWireFrame('received','42["registered",{"success":false,"errorCode":425}]','private-token'),{registrationReceived:true,registrationSucceeded:false,registrationError:425});
});
