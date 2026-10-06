import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseVideoSession,validateVideoSessions,saveVideoSessions,loadVideoSessions} from '../video-session-config.js';
test('OmeTV import requires the signed envelope and preserves its exact signed strings',()=>{
 const session={token:'fixture-a',SnDataStr:' {"name":"fixture"} ',SnHmac:'fixture-signature'};
 assert.deepEqual(parseVideoSession(JSON.stringify(session)),session);
 assert.throws(()=>parseVideoSession('f'.repeat(64)),/complete OmeTV/);
 assert.throws(()=>parseVideoSession({token:'fixture-a'}),/SnDataStr/);
 assert.throws(()=>validateVideoSessions([session,session]),/different/);
});
test('OmeTV session profiles persist privately and restore without changing signatures',async()=>{
 const data=await mkdtemp(join(tmpdir(),'video-session-'));
 try{const sessions=['a','b'].map(token=>({token,SnDataStr:' {"fixture":true} ',SnHmac:'test-signature'}));await saveVideoSessions(data,sessions);assert.deepEqual(await loadVideoSessions(data),sessions);assert.equal((await stat(data+'/video-sessions.json')).mode&0o777,0o600);assert.deepEqual(JSON.parse(await readFile(data+'/video-sessions.json','utf8')),sessions);}finally{await rm(data,{recursive:true,force:true});}
});
