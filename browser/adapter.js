'use strict';
const NTGAdapter=(()=>{
  const visible=el=>!!el&&el.isConnected&&el.getClientRects().length>0;
  const query=s=>{try{return Array.from(document.querySelectorAll(s));}catch{return [];}};
  const one=s=>query(s).find(visible);
  const incomingCandidates=['.message.incoming','.message.received','.message.other','.message.companion','.message.stranger','.message--incoming','.chat-message.partner','.companion_message','.message_company','.msg.incoming','[data-direction="incoming"]','[data-sender="stranger"]'];
  function detect(){
    const editor=one('.emojionearea-editor'),sendButton=one('#sendMessageBtn');
    if(editor&&sendButton)return {input:'.emojionearea-editor',send:'#sendMessageBtn',incoming:'.mess_block:not(.self)',textInside:'.window_chat_dialog_text',outgoing:'.mess_block.self',automatic:true};
    const scope=document.querySelector('.chat-box')||document.body;
    const input=Array.from(scope?.querySelectorAll('textarea,input[type="text"],[contenteditable="true"]')||[]).find(el=>visible(el)&&!el.id.includes('recaptcha'));
    if(!input)return null;
    const near=input.closest('form,.input-group')||input.parentElement?.parentElement||scope;
    const send=Array.from(near?.querySelectorAll('button,[role="button"]')||[]).find(el=>visible(el)&&(/отправить|send|жіберу/i.test(el.textContent+' '+el.getAttribute('aria-label'))||el.querySelector('.glyphicon-send')));
    const incoming=incomingCandidates.find(s=>query(s).some(visible));
    if(!send)return null;
    return {input:selector(input),send:selector(send),incoming:incomingCandidates.join(','),textInside:'.text,.message-text,.window_chat_dialog_text',outgoing:'',automatic:true};
  }
  function selector(el){
    if(el.id)return '#'+CSS.escape(el.id);
    const parts=[];
    for(let node=el;node&&node!==document.body;node=node.parentElement){
      if(node.id){parts.unshift('#'+CSS.escape(node.id));break;}
      const tag=node.tagName.toLowerCase(),classes=Array.from(node.classList).filter(x=>! /^(active|selected|hover|focus|disabled)$/.test(x));
      let part=tag+classes.map(x=>'.'+CSS.escape(x)).join('');
      const siblings=Array.from(node.parentElement?.children||[]).filter(n=>n.tagName===node.tagName);
      if(siblings.length>1)part+=':nth-of-type('+(siblings.indexOf(node)+1)+')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  }
  function read(profile){
    if(!profile)return {connected:false,messages:[]};
    const input=one(profile.input),send=one(profile.send);
    const blocked=['#mask_cap','#mask_hcap','#mask_bad','#mask_bad_inet','.status-end','#search_company_loading','.swal2-popup'].some(s=>visible(document.querySelector(s)));
    const searching=/\/searching(?:[/?]|$)/.test(location.hash);
    const connected=!!input&&!!send&&!input.disabled&&input.getAttribute('aria-disabled')!=='true'&&!blocked&&!searching;
    const matches=query(profile.incoming).filter(visible);
    const messages=matches.filter(el=>!matches.some(other=>other!==el&&other.contains(el))).map(el=>{
      const textNode=(profile.textInside?el.querySelector(profile.textInside):el)||el;
      return {el,text:(textNode?.innerText||textNode?.textContent||'')};
    }).filter(m=>m.text.trim());
    return {connected,input,send,messages};
  }
  const editable=input=>input.isContentEditable||input.getAttribute('contenteditable')==='true'||input.classList.contains('emojionearea-editor');
  function value(input){return editable(input)?input.textContent:input.value;}
  function setValue(input,text){
    if(editable(input))input.textContent=text;
    else{
      const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(input,text);
    }
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  return {visible,one,detect,selector,read,value,setValue};
})();
