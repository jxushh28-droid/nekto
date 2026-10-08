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
