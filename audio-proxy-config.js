import {readFile,writeFile,rename} from 'node:fs/promises';

export function normalizeAudioProxy(input){
 if(input==null||input==='')return null;
 if(typeof input!=='string'||input.length>4096)throw Error('Audio proxy must be a URL or one proxy-list row.');
 let value=input.trim();if(!value)return null;
 const rows=value.split(/\r?\n/).filter(row=>row.trim());
 const candidates=[];
 for(const row of rows){
  const cells=row.includes('|')?row.split('|').map(x=>x.trim()).filter(Boolean):row.trim().split(/\s+/);
  if(/^(socks5|https?)$/i.test(cells[0]||'')&&cells[1]&&/^\d+$/.test(cells[2]||''))candidates.push(cells[0].toLowerCase()+'://'+cells[1]+':'+cells[2]);
 }
 if(candidates.length>1)throw Error('Audio proxy: paste one proxy row for each browser.');
 if(candidates.length)value=candidates[0];
 if(!value.includes('://'))value='http://'+value;
 let url;try{url=new URL(value);}catch{throw Error('Audio proxy URL is invalid.');}
 if(!['http:','https:','socks5:'].includes(url.protocol)||!url.hostname||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('Audio proxy: use http://host:port or socks5://host:port.');
 if(!url.port&&!['http:','https:'].includes(url.protocol))throw Error('Audio SOCKS5 proxy needs a port.');
 if(url.port==='0')throw Error('Audio proxy port must be between 1 and 65535.');
 if(url.protocol==='socks5:'&&(url.username||url.password))throw Error('Audio SOCKS5 proxy authentication is not supported. Use a proxy without credentials.');
 try{decodeURIComponent(url.username);decodeURIComponent(url.password);}catch{throw Error('Audio proxy credentials are invalid.');}
 url.pathname='';return url.href.replace(/\/$/,'');
}
export function audioProxyOptions(input){
 const value=normalizeAudioProxy(input);if(!value)return undefined;
 const url=new URL(value),username=decodeURIComponent(url.username),password=decodeURIComponent(url.password);
 url.username='';url.password='';
 return {server:url.href.replace(/\/$/,''),...(username?{username,password}:{} )};
}
export function validateAudioProxies(values){
 if(!Array.isArray(values)||values.length!==2)throw Error('Audio proxies need one setting for A and one for B.');
 return values.map(normalizeAudioProxy);
}
export async function loadAudioProxies(directory){
 try{return validateAudioProxies(JSON.parse(await readFile(directory+'/proxies.json','utf8')));}
 catch(e){if(e.code==='ENOENT')return [null,null];throw Error('Saved audio proxy configuration is invalid.');}
}
export async function saveAudioProxies(directory,values){
 const proxies=validateAudioProxies(values),path=directory+'/proxies.json';
 await writeFile(path+'.tmp',JSON.stringify(proxies),{mode:0o600});await rename(path+'.tmp',path);return proxies;
}
