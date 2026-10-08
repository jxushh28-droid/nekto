// Evaluated against a JavaScript handle from the selected native page.
export function formatNativeConsoleValue(value){
 const seen=new WeakSet();
 const inspect=(v,depth)=>{
  if(v===undefined)return 'undefined';
  if(typeof v==='bigint')return String(v)+'n';
  if(typeof v==='function'||typeof v==='symbol')return String(v).slice(0,2000);
  if(typeof v==='string')return v.slice(0,12000);
  if(v===null||typeof v!=='object')return v;
  if(seen.has(v))return '[Circular]';
  if(depth===0)return '[Object]';
  seen.add(v);
  if(typeof Node!=='undefined'&&v instanceof Node)return (v.outerHTML||v.nodeName).slice(0,12000);
  if(v instanceof Error)return v.name+': '+v.message;
  if(v instanceof Date)return String(v);
  if(Array.isArray(v))return v.slice(0,50).map(x=>inspect(x,depth-1));
  const result={};
  for(const key of Object.keys(v).slice(0,50)){
   try{Object.defineProperty(result,key,{value:inspect(v[key],depth-1),enumerable:true});}catch{result[key]='[Unreadable]';}
  }
  return result;
 };
 try{const result=inspect(value,4);return (typeof result==='string'?result:JSON.stringify(result,null,2)).slice(0,12000);}
 catch{return '[Value could not be displayed]';}
}
