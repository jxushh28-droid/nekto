import {readFile,writeFile,rename,chmod} from 'node:fs/promises';
export function parseVideoSession(value){
 let session;try{session=typeof value==='string'?JSON.parse(value):value;}catch{throw new Error('Paste the complete OmeTV snid JSON, not a Nekto token.');}
 if(!session||typeof session!=='object'||Array.isArray(session))throw new Error('Paste the complete OmeTV snid JSON, not a Nekto token.');
 for(const key of ['token','SnDataStr','SnHmac'])if(typeof session[key]!=='string'||!session[key].length||session[key].length>12000)throw new Error('OmeTV session requires token, SnDataStr and SnHmac.');
 if(session.auxId!=null&&(!Number.isSafeInteger(session.auxId)||session.auxId<=0))throw new Error('OmeTV session auxId must be a positive integer.');
 return {token:session.token,SnDataStr:session.SnDataStr,SnHmac:session.SnHmac,...(session.auxId!=null?{auxId:session.auxId}:{})};
}
export function validateVideoSessions(values){if(!Array.isArray(values)||values.length!==2)throw new Error('Provide two OmeTV sessions.');const sessions=values.map(parseVideoSession);if(sessions[0].token===sessions[1].token)throw new Error('Use two different OmeTV sessions.');if(sessions[0].auxId&&sessions[0].auxId===sessions[1].auxId)throw new Error('Use two different OmeTV accounts; these sessions have the same auxId.');return sessions;}
export async function loadVideoSessions(data){try{return validateVideoSessions(JSON.parse(await readFile(data+'/video-sessions.json','utf8')));}catch{return [null,null];}}
export async function saveVideoSessions(data,sessions){const path=data+'/video-sessions.json',temp=path+'.tmp';await writeFile(temp,JSON.stringify(validateVideoSessions(sessions)),{mode:0o600});await chmod(temp,0o600);await rename(temp,path);}
