const origin='https://nekto-me.kz';
const key='storage_audio_v2';

// Import the user's session before creating a page. This runs once per context,
// rather than replacing a token on subsequent navigations or child frames.
export function voiceStorageState(token,previous={cookies:[],origins:[]}){
  const state=structuredClone(previous);
  let entry=state.origins.find(item=>item.origin===origin);
  if(!entry){entry={origin,localStorage:[]};state.origins.push(entry);}
  let storage=entry.localStorage.find(item=>item.name===key);
  const saved=JSON.parse(storage?.value||'{}');
  if(!saved||typeof saved!=='object'||Array.isArray(saved)||
    (saved.user!=null&&(typeof saved.user!=='object'||Array.isArray(saved.user))))
    throw Error('Audio saved browser storage is invalid.');
  saved.user={...(saved.user||{}),authToken:token};
  if(!storage){storage={name:key,value:''};entry.localStorage.push(storage);}
  storage.value=JSON.stringify(saved);
  return state;
}

export function voiceStorageMatches(state,token){
  try{return JSON.parse(state.origins.find(item=>item.origin===origin)?.localStorage.find(item=>item.name===key)?.value||'{}')?.user?.authToken===token;}
  catch{return false;}
}
