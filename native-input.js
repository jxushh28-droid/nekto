export const nativeKeys=new Set(['Tab','Shift+Tab','Enter','Space','Backspace','Delete','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Control+A']);

export function validateNativeInput(input){
 if(!input||typeof input.epoch!=='string'||!input.epoch)throw Error('Audio screen changed. Refresh it before interacting.');
 if(input.action==='click'){
  if(!Number.isFinite(input.x)||!Number.isFinite(input.y)||input.x<0||input.x>1||input.y<0||input.y>1)throw Error('Audio screen coordinates are invalid.');
  return {action:'click',x:input.x,y:input.y};
 }
 if(input.action==='text'){
  if(typeof input.text!=='string'||!input.text.length||input.text.length>2000)throw Error('Audio screen text must contain 1–2000 characters.');
  return {action:'text',text:input.text};
 }
 if(input.action==='key'&&nativeKeys.has(input.key))return {action:'key',key:input.key};
 if(input.action==='scroll'&&Number.isFinite(input.deltaY)&&Math.abs(input.deltaY)<=1080)return {action:'scroll',deltaY:input.deltaY};
 throw Error('Audio screen action is invalid.');
}
