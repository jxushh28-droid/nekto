export const ORIGIN='https://nekto-me.kz';
const authKey=key=>/^auth_?token$/i.test(key);
export function validateTokens(tokens){
 if(!Array.isArray(tokens)||tokens.length!==2)throw new Error('Enter one authToken for each of the two sessions.');
 const values=tokens.map(t=>{if(typeof t!=='string')throw new Error('Invalid authToken.');const v=t.trim();if(v.length<8||v.length>2048||/[\s\x00-\x1f\x7f]/.test(v))throw new Error('Invalid authToken format.');return v;});
 if(values[0]===values[1])throw new Error('Use two different session tokens.');return values;
}
function updateFields(value,token,depth=0){
 if(!value||typeof value!=='object'||depth>12)return 0;let count=0;
 for(const key of Object.keys(value)){if(authKey(key)&&typeof value[key]==='string'){value[key]=token;count++;}else count+=updateFields(value[key],token,depth+1);}return count;
}
export function withToken(storage,token){
 const state=structuredClone(storage||{cookies:[],origins:[]});let count=0;
 for(const origin of state.origins||[]){if(origin.origin!==ORIGIN)continue;
  for(const item of origin.localStorage||[]){if(item.name==='storage_audio_v2')continue;
   if(authKey(item.name)){item.value=token;count++;continue;}
   try{const obj=JSON.parse(item.value);const updated=updateFields(obj,token);if(updated){item.value=JSON.stringify(obj);count+=updated;}}catch{}
  }
 }
 for(const cookie of state.cookies||[]){if(cookie.domain.replace(/^\./,'')==='nekto-me.kz'&&authKey(cookie.name)){cookie.value=token;count++;}}
 // The text client reads this specific key at startup. Preserve its settings.
 let origin=state.origins.find(o=>o.origin===ORIGIN);
 if(!origin){origin={origin:ORIGIN,localStorage:[]};state.origins.push(origin);}
 let item=origin.localStorage.find(x=>x.name==='storage_v2');
 if(!item){item={name:'storage_v2',value:'{}'};origin.localStorage.push(item);}
 let value;try{value=JSON.parse(item.value);}catch{value={};}
 if(!value||typeof value!=='object'||Array.isArray(value))value={};
 if(!value.user||typeof value.user!=='object')value.user={};
 value.user.authToken=token;item.value=JSON.stringify(value);
 return {state,count};
}
