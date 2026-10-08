// Runs in the native page. Return comparisons only, never token values.
export function inspectVoiceToken(expectedToken){
 const store=[...document.querySelectorAll('*')].map(el=>el.__vue__?.$store).find(s=>s?.state?.system&&s.state.user);
 let savedToken=null,storageReadable=true;
 try{savedToken=JSON.parse(localStorage.getItem('storage_audio_v2')||'{}')?.user?.authToken??null;}catch{storageReadable=false;}
 const user=store?.state.user,system=store?.state.system;
 return {
  clientFound:!!store,storageReadable,
  savedTokenMatches:typeof expectedToken==='string'&&savedToken===expectedToken,
  liveTokenMatches:typeof expectedToken==='string'&&user?.authToken===expectedToken,
  authenticated:system?.isAuth===true,socketConnected:system?.socketConnected===true,
  identityPresent:user?.tokenId!=null,
  captcha:!!system?.captchaRequired,hcaptcha:!!system?.hcaptchaRequired,
  restricted:!!system?.forceDisconnectReason,
  registrationError:Number(system?.errorRegistered)||0
 };
}

// Explicit authenticated inspection only. Do not include this result in logs/status.
export function readVoiceStorageToken(){
 if(location.origin!=='https://nekto-me.kz')throw Error('Audio native browser left Nekto.');
 const key='storage_audio_v2',path='user.authToken';
 try{
  const raw=localStorage.getItem(key);
  const token=raw===null?null:JSON.parse(raw)?.user?.authToken;
  return {origin:location.origin,key,path,storageReadable:true,token:typeof token==='string'?token:null};
 }catch{return {origin:location.origin,key,path,storageReadable:false,token:null};}
}
