import {isIP} from 'node:net';

// The request uses the live browser context, including its proxy settings.
// A temporary tab leaves the native chat page and its call untouched.
export async function readBrowserIp(context){
 const page=await context.newPage();
 try{
  const response=await page.goto('https://api64.ipify.org?format=json',{waitUntil:'domcontentloaded',timeout:10000});
  if(!response?.ok())throw Error('IP lookup failed.');
  const {ip}=JSON.parse(await response.text());
  if(typeof ip!=='string'||!isIP(ip))throw Error('Invalid IP lookup response.');
  return ip;
 }finally{await page.close().catch(()=>{});}
}
