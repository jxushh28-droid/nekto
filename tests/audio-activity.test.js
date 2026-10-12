import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import {parseHTML} from 'linkedom';
test('eye activity follows each incoming PCM stream with listening off and ignores an old session',async()=>{
  const {window,document}=parseHTML(await readFile(new URL('../public/audio.html',import.meta.url),'utf8')),sources=[];
  const status={enabled:false,requested:false,setup:false,configured:[false,false],slots:[0,1].map(i=>({label:i?'B':'A',attemptId:'active-'+i,connected:true,open:true,status:'connected',storageAvailable:false,interactive:false,level:0,db:-60}))};
  class Feed{constructor(url){this.url=url;sources.push(this);}close(){}addEventListener(){}}
  const context={window,document,EventSource:Feed,atob,URL,setTimeout,clearTimeout,setInterval:()=>0,fetch:async path=>({ok:true,status:path.endsWith('/screen')?204:200,headers:{get:()=>null},json:async()=>path.endsWith('/status')?status:{tokens:['','']}})};
  vm.runInNewContext(await readFile(new URL('../public/audio.js',import.meta.url),'utf8'),context);await new Promise(r=>setImmediate(r));
  const pcm=Buffer.alloc(2048);for(let i=0;i<1024;i++)pcm.writeInt16LE(4096,i*2);
  const packet=generation=>({data:JSON.stringify({generation,data:pcm.toString('base64'),rate:24000})});
  try{
    assert.equal(sources.length,2);sources[0].onmessage(packet('retired'));assert.equal(document.querySelector('#card0 .speaker').classList.contains('speaking'),false);
    sources[0].onmessage(packet('active-0'));assert.equal(document.querySelector('#card0 .speaker').classList.contains('speaking'),true);assert.equal(document.querySelector('#card1 .speaker').classList.contains('speaking'),false);
    assert.equal(document.querySelector('#card0 .listen').getAttribute('aria-pressed'),'false');
    status.slots[0].connected=false;await vm.runInNewContext('refresh()',context);assert.equal(document.querySelector('#card0 .speaker').classList.contains('speaking'),false);
    sources[0].onmessage(packet('active-0'));assert.equal(document.querySelector('#card0 .speaker').classList.contains('speaking'),false);
  }finally{vm.runInNewContext('stop(0);stop(1)',context);}
});
