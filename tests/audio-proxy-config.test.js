import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeAudioProxy,audioProxyOptions,loadAudioProxies} from '../audio-proxy-config.js';
import {AudioHost} from '../audio-host.js';

test('proxy URL and copied list row normalize to the same SOCKS5 setting',()=>{
 const row='| socks5 | 203.0.113.8 | 443 | DE | Germany | elite | | 24ms | 1 sec ago |\n| ------ | ----------- | --- | -- | ------------ | ----- | - | ---- | --------- |';
 assert.equal(normalizeAudioProxy(row),'socks5://203.0.113.8:443');
 assert.deepEqual(audioProxyOptions(row),{server:'socks5://203.0.113.8:443'});
 assert.equal(normalizeAudioProxy('socks5\t203.0.113.8\t443\tDE'),'socks5://203.0.113.8:443');
 assert.equal(normalizeAudioProxy('  '),null);assert.equal(audioProxyOptions(''),undefined);
 assert.deepEqual(audioProxyOptions('http://user:secret%20value@proxy.example:8080'),{server:'http://proxy.example:8080',username:'user',password:'secret value'});
 assert.equal(normalizeAudioProxy('socks5://[2001:db8::1]:1080'),'socks5://[2001:db8::1]:1080');
});
test('invalid proxies and unsupported authentication are rejected without choosing another route',()=>{
 for(const value of ['file:///data','socks5://example.test','socks5://example.test:0','socks5://example.test:70000','socks5://user:password@example.test:1080','http://proxy.example:8000/path','http://proxy.example:8000?next=1'])assert.throws(()=>normalizeAudioProxy(value),/proxy/i);
 assert.throws(()=>normalizeAudioProxy('socks5 203.0.113.8 1080\nsocks5 203.0.113.9 1080'),/one proxy row/);
});
test('saved proxy settings are private and each audio browser launches through its chosen proxy',async()=>{
 const data=await mkdtemp(join(tmpdir(),'audio-proxy-')),launches=[];
 const graph={ensure:async()=>{},browserEnv:i=>({PULSE_SOURCE:'fixture-'+i}),close:async()=>{}};
 const host=new AudioHost({data,graph,launch:async options=>{launches.push(options);throw Error('fixture launch stop');}});clearInterval(host.timer);
 try{
  await host.loaded;assert.deepEqual(host.proxies,[null,null]);
  await host.configureProxies(['socks5 203.0.113.8 443','http://proxy.example:8080']);
  assert.deepEqual(await loadAudioProxies(data+'/audio'),['socks5://203.0.113.8:443','http://proxy.example:8080']);
  assert.equal((await stat(data+'/audio/proxies.json')).mode&0o777,0o600);
  host.tokens=['fixture-token-A','fixture-token-B'];
  for(let i=0;i<2;i++)await assert.rejects(host.prepare(i),/fixture launch stop/);
  assert.equal(launches.length,2);assert.equal(launches[0].proxy.server,'socks5://203.0.113.8:443');assert.equal(launches[1].proxy.server,'http://proxy.example:8080');
  for(let i=0;i<2;i++){assert.equal(launches[i].env.PULSE_SOURCE,'fixture-'+i);assert.ok(launches[i].args.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'));}
  host.slots[0]={stopped:true};await assert.rejects(host.configureProxies(['','']),/close both browsers/);host.slots[0]=null;
  await assert.rejects(host.configureProxies(['file:///bad','']),/proxy/i);assert.equal(host.proxies[0],'socks5://203.0.113.8:443');
 }finally{await host.shutdown();await rm(data,{recursive:true,force:true});}
});
