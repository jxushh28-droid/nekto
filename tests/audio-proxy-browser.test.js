import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {chromium} from 'playwright';
import {audioProxyOptions} from '../audio-proxy-config.js';

test('Chromium actually connects through the configured SOCKS5 proxy',async()=>{
 const targets=[],sockets=new Set();
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  let buffer=Buffer.alloc(0),stage=0;
  socket.on('data',data=>{
   buffer=Buffer.concat([buffer,data]);
   if(stage===0){if(buffer.length<2||buffer.length<2+buffer[1])return;buffer=buffer.subarray(2+buffer[1]);socket.write(Buffer.from([5,0]));stage=1;}
   if(stage===1){
    if(buffer.length<5)return;
    const type=buffer[3],length=type===3?buffer[4]:type===1?4:16,offset=type===3?5:4;
    if(buffer.length<offset+length+2)return;
    const hostname=type===3?buffer.subarray(offset,offset+length).toString():buffer.subarray(offset,offset+length).join('.');
    const port=buffer.readUInt16BE(offset+length);targets.push({hostname,port});buffer=buffer.subarray(offset+length+2);
    socket.write(Buffer.from([5,0,0,1,127,0,0,1,0,0]));stage=2;
   }
   if(stage===2&&buffer.includes(Buffer.from('\r\n\r\n'))){const body='<h1>SOCKS5 browser fixture</h1>';socket.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: '+Buffer.byteLength(body)+'\r\nConnection: close\r\n\r\n'+body);stage=3;}
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  const proxy=audioProxyOptions('socks5://127.0.0.1:'+server.address().port);
  browser=await chromium.launch({headless:true,proxy});const page=await browser.newPage();
  await page.goto('http://audio-proxy-fixture.test/',{timeout:10000});
  assert.equal(await page.locator('h1').textContent(),'SOCKS5 browser fixture');assert.ok(targets.some(x=>x.hostname==='audio-proxy-fixture.test'&&x.port===80));
 }finally{await browser?.close();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
});
