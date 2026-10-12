import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

test('simulator events are local and starting/stopping a scenario makes no network request',async()=>{
 const {window,document}=parseHTML(await readFile(new URL('../public/simulator.html',import.meta.url),'utf8'));
 const requests=[];let advance;
 const context={window,document,fetch:async path=>{requests.push(path);return {ok:true,json:async()=>({})};},setInterval:fn=>{advance=fn;return 1;},clearInterval:()=>{advance=null;},Number,Error};
 vm.runInNewContext(await readFile(new URL('../public/simulator.js',import.meta.url),'utf8'),context);await new Promise(r=>setImmediate(r));
 assert.deepEqual(requests,['/api/status']);
 document.getElementById('simulationPhone').value='+7 700 000 00 00';document.getElementById('simulationCount').value='2';Object.defineProperty(document.getElementById('simulationChannel'),'value',{value:'both'});
 document.getElementById('simulationForm').onsubmit({preventDefault(){}});advance();advance();
 assert.equal(document.querySelectorAll('#simulationLog li').length,2);assert.match(document.querySelector('#simulationLog li').textContent,/локальная симуляция/);
 assert.match(document.getElementById('simulationSummary').textContent,/Отправлено SMS и звонков: 0/);assert.deepEqual(requests,['/api/status']);assert.equal(advance,null);
 document.getElementById('simulationClear').onclick();assert.equal(document.querySelectorAll('#simulationLog li').length,0);
});
