import {readFile,writeFile,rename} from 'node:fs/promises';
import {validateTokens} from './session.js';
export async function loadTokens(directory){try{return validateTokens(JSON.parse(await readFile(directory+'/tokens.json','utf8')));}catch(error){if(error.code==='ENOENT')return [null,null];throw new Error('Saved token configuration is invalid.');}}
export async function saveTokens(directory,tokens){const values=validateTokens(tokens);const path=directory+'/tokens.json';await writeFile(path+'.tmp',JSON.stringify(values),{mode:0o600});await rename(path+'.tmp',path);return values;}
