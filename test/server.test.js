import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

test('HTTP multiplayer lifecycle, private snapshots, reconnect, chat, host controls', { timeout: 20000 }, async t => {
  const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',ALLOWED_ORIGINS:'https://test.example'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{
    child.stdout.on('data',data=>{const match=String(data).match(/http:\/\/localhost:\d+/);if(match)resolve(match[0]);});
    child.on('error',reject);child.on('exit',code=>reject(new Error(`Server exited: ${code}`)));
  });
  const post=async(path,data={},token)=>{
    const res=await fetch(`${base}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://test.example',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)});
    return {status:res.status,...await res.json()};
  };
  const subscribe=async(token)=>{
    const abort=new AbortController();t.after(()=>abort.abort());
    const response=await fetch(`${base}/api/events?token=${token}`,{signal:abort.signal});assert.equal(response.status,200);
    const snapshots=[]; const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer='';
    (async()=>{try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n\n'))!==-1){const event=buffer.slice(0,index);buffer=buffer.slice(index+2);if(event.startsWith('data: '))snapshots.push(JSON.parse(event.slice(6)));}}}catch{}})();
    return {snapshots,abort};
  };
  const until=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await delay(20);}assert.fail('Timed out waiting for a state update');};
  assert.equal((await fetch(`${base}/api/health`)).status,200);
  assert.equal((await fetch(`${base}/`,{method:'GET'})).status,200);
  assert.equal((await fetch(`${base}/api/health`,{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await post('action',{type:'draw'})).status,401);
  const a=await post('create',{name:'Ada'}), b=await post('join',{name:'Bea',code:a.code});
  assert.equal(a.status,200);assert.equal(b.status,200);
  const lobbies = async () => (await (await fetch(`${base}/api/lobbies`)).json()).lobbies;
  assert.deepEqual(await lobbies(), []);
  const sa=await subscribe(a.token),sb=await subscribe(b.token);
  await until(()=>sa.snapshots.at(-1)?.players.every(p=>p.online));
  assert.deepEqual(await lobbies(), [{ code: a.code, host: 'Ada', players: 2, capacity: 4 }]);
  assert.equal((await post('action',{type:'start'},b.token)).status,400);
  assert.equal((await post('action',{type:'start'},a.token)).status,200);
  await until(()=>sb.snapshots.at(-1)?.phase==='playing');
  assert.deepEqual(await lobbies(), []);
  const view=sb.snapshots.at(-1);assert.equal(view.hand.length,7);assert.equal(view.players[0].hand,undefined);assert.equal(view.players[0].token,undefined);
  assert.equal((await post('join',{name:'Late',code:a.code})).status,400);
  assert.equal((await post('action',{type:'draw'},b.token)).status,400);
  assert.equal((await post('chat',{text:'<script>alert(1)</script>'},a.token)).status,200);
  await until(()=>sb.snapshots.at(-1)?.chat.length===1);
  const handIds=sb.snapshots.at(-1).hand.map(c=>c.id);
  sb.abort.abort(); await until(()=>sa.snapshots.at(-1)?.players.find(p=>p.id===b.playerId).online===false);
  const resumed=await subscribe(b.token);await until(()=>resumed.snapshots.length>0);
  assert.deepEqual(resumed.snapshots.at(-1).hand.map(c=>c.id),handIds);
  assert.equal((await post('kick',{playerId:a.playerId},b.token)).status,400);
  assert.equal((await post('leave',{},a.token)).status,200);
  await until(()=>resumed.snapshots.at(-1)?.host===b.playerId);
  assert.equal(resumed.snapshots.at(-1).phase,'lobby');
  assert.deepEqual(await lobbies(), [{ code: a.code, host: 'Bea', players: 1, capacity: 4 }]);
  assert.equal((await post('action',{type:'draw'},a.token)).status,401);
  for (const name of ['Cal', 'Dee', 'Eli']) assert.equal((await post('join', { name, code: a.code })).status, 200);
  assert.deepEqual(await lobbies(), []);
  const fifth = await post('join', { name: 'Fay', code: a.code });
  assert.equal(fifth.status, 400);
  assert.match(fifth.error, /full \(4 players\)/);

});
