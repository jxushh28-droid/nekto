'use strict';
const ORIGIN='https://nekto-me.kz',KEY='storage_audio_v2';
// Preserve the site's other persisted fields. Only set the caller's configured token.
function withToken(storage,token){const state=structuredClone(storage||{cookies:[],origins:[]});if(!token)return state;
 if(token.length>512||/[\r\n\x00]/.test(token))throw Error('Invalid Nekto token format');
 const origins=state.origins||(state.origins=[]);let origin=origins.find(o=>o.origin===ORIGIN);if(!origin){origin={origin:ORIGIN,localStorage:[]};origins.push(origin);}let item=origin.localStorage.find(i=>i.name===KEY);let value={};if(item){try{value=JSON.parse(item.value);}catch{throw Error('Saved Nekto session is malformed');}}if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Saved Nekto session is malformed');value.user={...(value.user||{}),authToken:token};const encoded=JSON.stringify(value);if(item)item.value=encoded;else origin.localStorage.push({name:KEY,value:encoded});return state;}
module.exports={ORIGIN,KEY,withToken};
