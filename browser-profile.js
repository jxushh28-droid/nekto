import {readFile,writeFile,mkdir,rename,chmod,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';

const empty=()=>({cookies:[],origins:[]});
const digest=value=>value==null?null:createHash('sha256').update(value).digest('hex');

// Keep only this provider's own cookies and local storage. Profiles stay on
// disk and never become part of the dashboard or diagnostic responses.
export function providerStorage(state,origin){
 if(!state||!Array.isArray(state.cookies)||!Array.isArray(state.origins))throw Error('Invalid browser profile.');
 const hostname=new URL(origin).hostname;
 const cookies=state.cookies.filter(cookie=>{
  if(!cookie||typeof cookie.domain!=='string')throw Error('Invalid browser profile.');
  const domain=cookie.domain.replace(/^\./,'');
  return domain===hostname||domain.endsWith('.'+hostname);
 });
 const origins=state.origins.filter(entry=>entry?.origin===origin).map(entry=>{
  if(!Array.isArray(entry.localStorage)||entry.localStorage.some(item=>typeof item?.name!=='string'||typeof item.value!=='string'))throw Error('Invalid browser profile.');
  return {origin,localStorage:entry.localStorage};
 });
 return structuredClone({cookies,origins});
}

export class BrowserProfiles{
 constructor(directory,origin){this.directory=directory;this.origin=origin;this.pending=[Promise.resolve(),Promise.resolve()];}
 async load(i,identity=null){
  await this.pending[i];
  let saved;
  try{saved=JSON.parse(await readFile(this.directory+'/'+i+'.json','utf8'));}
  catch(error){if(error.code==='ENOENT')return {state:empty(),restored:false};throw Error('Saved browser profile could not be read.');}
  if(saved?.version!==1)throw Error('Saved browser profile is invalid.');
  if(saved.identity!==digest(identity))return {state:empty(),restored:false};
  return {state:providerStorage(saved.state,this.origin),restored:true};
 }
 async save(i,state,identity=null){
  const value={version:1,identity:digest(identity),state:providerStorage(state,this.origin)};
  const operation=this.pending[i].then(async()=>{
   await mkdir(this.directory,{recursive:true,mode:0o700});
   await chmod(this.directory,0o700);
   const path=this.directory+'/'+i+'.json',temporary=path+'.'+randomUUID()+'.tmp';
   try{await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);}
   finally{await rm(temporary,{force:true});}
  });
  this.pending[i]=operation.catch(()=>{});
  await operation;
 }
}
