import {readFile,writeFile,rename} from 'node:fs/promises';

function validate(tokens) {
 if(!Array.isArray(tokens)||tokens.length!==2)throw Error('Invalid audio token configuration.');
 const values=tokens.map(token=>{
  if(token==null||token==='')return null;
  if(typeof token!=='string')throw Error('Invalid audio authToken.');
  const value=token.trim();
  if(value.length<8||value.length>2048||/[\s\x00-\x1f\x7f]/.test(value))throw Error('Invalid audio authToken format.');
  return value;
 });
 if(values[0]&&values[0]===values[1])throw Error('Use two different session tokens.');
 return values;
}
export async function loadAudioTokens(directory){try{return validate(JSON.parse(await readFile(directory+'/tokens.json','utf8')));}catch(error){if(error.code==='ENOENT')return [null,null];throw Error('Saved audio token configuration is invalid.');}}
export async function saveAudioTokens(directory,tokens){const values=validate(tokens),path=directory+'/tokens.json';await writeFile(path+'.tmp',JSON.stringify(values),{mode:0o600});await rename(path+'.tmp',path);return values;}
