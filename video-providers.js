import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
export const videoProviders={
  umingle:{id:'umingle',name:'Umingle',origin:'https://umingle.com',url:'https://umingle.com/video/',start:'button.skipButton',message:'textarea.messageInput',localVideo:'#myVideo'},
  chatruletka:{id:'chatruletka',name:'Chatruletka',origin:'https://chatruletka.com',url:'https://chatruletka.com/#app',start:'.btn.btn-main:not(.disabled):not([aria-disabled="true"]):has([data-tr="start"])',message:'#chat-text',localVideo:'#local-video'},
};
export function videoProvider(id){const provider=videoProviders[id];if(!provider)throw Error('Video provider must be Umingle or Chatruletka.');return provider;}

// Both providers can create anonymous sessions themselves. Optional imports
// use the browser's storageState format, scoped to the selected provider.
// There is no invented shared authToken key or authorization endpoint.
export function parseProviderSession(value,id){
  const provider=videoProvider(id);if(value==null||value==='')return null;
  let state;try{state=typeof value==='string'?JSON.parse(value):structuredClone(value);}catch{throw Error('Video session must be browser-session JSON (cookies and origins).');}
  if(!state||!Array.isArray(state.cookies)||!Array.isArray(state.origins))throw Error('Video session must contain cookies and origins. Leave it empty for a native anonymous session.');
  if(JSON.stringify(state).length>120000||state.cookies.length>80||state.origins.length>4)throw Error('Video session is too large.');
  const hostname=new URL(provider.origin).hostname;
  const challenge=name=>/captcha|turnstile|clearance|(?:^|_)cf_|(?:^|_)ban(?:ned|_|$)|fingerprint|verification|restriction/i.test(name);
  const cookies=state.cookies.map(cookie=>{
    if(!cookie||typeof cookie.name!=='string'||typeof cookie.value!=='string'||typeof cookie.domain!=='string'||typeof cookie.path!=='string'||!cookie.path.startsWith('/'))throw Error('Video session contains an invalid cookie.');
    const domain=cookie.domain.replace(/^\./,'');if(domain!==hostname&&!domain.endsWith('.'+hostname))throw Error('Video session belongs to a different provider.');
    if(challenge(cookie.name))throw Error('Video session imports cannot include verification or restriction state.');
    if(typeof cookie.expires!=='number'||!Number.isFinite(cookie.expires)||typeof cookie.httpOnly!=='boolean'||typeof cookie.secure!=='boolean'||!['Strict','Lax','None'].includes(cookie.sameSite))throw Error('Video session cookies must use the browser storageState format.');
    return {name:cookie.name,value:cookie.value,domain:cookie.domain,path:cookie.path,expires:cookie.expires,httpOnly:cookie.httpOnly,secure:cookie.secure,sameSite:cookie.sameSite};
  });
  const origins=state.origins.map(entry=>{
    if(entry?.origin!==provider.origin||!Array.isArray(entry.localStorage)||entry.localStorage.length>150)throw Error('Video session belongs to a different provider.');
    return {origin:entry.origin,localStorage:entry.localStorage.map(item=>{
      if(typeof item?.name!=='string'||typeof item.value!=='string')throw Error('Video session contains invalid local storage.');
      if(challenge(item.name))throw Error('Video session imports cannot include verification or restriction state.');
      return {name:item.name,value:item.value};
    })};
  });
  return {cookies,origins};
}
export function providerSessionPair(values,id){
  if(!Array.isArray(values)||values.length!==2)throw Error('Video requires session fields for A and B.');
  const pair=values.map(value=>parseProviderSession(value,id));
  if(pair[0]&&pair[1]&&JSON.stringify(pair[0])===JSON.stringify(pair[1]))throw Error('Video sessions A and B must be different. Leave both empty to create separate anonymous sessions.');
  return pair;
}
export async function loadProviderConfig(data){
  try{const config=JSON.parse(await readFile(data+'/video-providers.json','utf8'));videoProvider(config.provider);const sessions={};for(const id of Object.keys(videoProviders))sessions[id]=providerSessionPair(config.sessions?.[id]||[null,null],id);return {provider:config.provider,sessions};}
  catch{return {provider:'umingle',sessions:{umingle:[null,null],chatruletka:[null,null]}};}
}
export async function saveProviderConfig(data,config){
  await mkdir(data,{recursive:true});const path=data+'/video-providers.json',temporary=path+'.tmp';await writeFile(temporary,JSON.stringify(config),{mode:0o600});await rename(temporary,path);
}
