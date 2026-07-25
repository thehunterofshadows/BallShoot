'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createServer } = require('../server/server');

function client(url){
  const ws=new WebSocket(url),queue=[],waiters=[];
  ws.on('message',raw=>{const msg=JSON.parse(raw);const i=waiters.findIndex(w=>w.type===msg.type);if(i>=0)waiters.splice(i,1)[0].resolve(msg);else queue.push(msg);});
  const opened=new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  return {ws,opened,send(value){ws.send(JSON.stringify(value));},next(type){const i=queue.findIndex(m=>m.type===type);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timed out waiting for ${type}`)),2500);waiters.push({type,resolve:m=>{clearTimeout(timer);resolve(m);}});});}};
}
async function nextWhere(c,type,predicate){for(let i=0;i<8;i++){const value=await c.next(type);if(predicate(value))return value;}throw new Error(`No matching ${type} message`);}

test('two websocket clients create, join, start, input, and receive one authoritative match', async () => {
  const app=createServer();await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const port=app.server.address().port,url=`ws://127.0.0.1:${port}/ws`;
  const a=client(url),b=client(url);await Promise.all([a.opened,b.opened]);
  a.send({type:'create',name:'Alpha'});const aj=await a.next('joined');assert.match(aj.room.code,/^\d{3}$/);
  b.send({type:'join',code:aj.room.code,name:'Bravo'});const bj=await b.next('joined');assert.equal(bj.room.players.length,2);
  await a.next('lobby_state');a.send({type:'start'});const [as,bs]=await Promise.all([a.next('match_started'),b.next('match_started')]);
  assert.equal(as.snapshot.tick,bs.snapshot.tick);b.send({type:'input',seq:1,held:{r:true}});b.send({type:'fire'});
  const [snapA,snapB]=await Promise.all([a.next('snapshot'),b.next('snapshot')]);assert.equal(snapA.snapshot.tick,snapB.snapshot.tick);assert.deepEqual(snapA.snapshot.grid,snapB.snapshot.grid);
  a.ws.terminate();b.ws.terminate();app.wss.close();await new Promise(resolve=>app.server.close(resolve));
});

test('the leaderboard endpoint reads and writes over plain HTTP', async () => {
  // Plain HTTP, not the room socket, because Local offline play never opens one.
  const app=createServer();await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}/scores`;
  const post=body=>fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

  const empty=await fetch(`${base}?mode=clear&level=0`);
  assert.equal(empty.status,200);
  assert.deepEqual((await empty.json()).entries,[]);

  const saved=await post({initials:'ada',score:4200,mode:'clear',level:0});
  assert.equal(saved.status,200);
  const result=await saved.json();
  assert.equal(result.rank,1);
  assert.equal(result.entries[0].initials,'ADA','initials are normalised server-side');

  const listed=await fetch(`${base}?mode=clear&level=0`);
  assert.equal(listed.headers.get('cache-control'),'no-store','never cached by the JS rules');
  assert.equal((await listed.json()).entries[0].score,4200);

  // A different bucket is untouched by that submission.
  assert.deepEqual((await (await fetch(`${base}?mode=clear&level=1`)).json()).entries,[]);

  // Rejections are 4xx with a code, not a crash.
  for (const bad of [{initials:'',score:1,mode:'clear',level:0},{initials:'AAA',score:-5,mode:'clear',level:0},
                     {initials:'AAA',score:1,mode:'nope',level:0},{initials:'AAA',score:1,mode:'clear',level:42}]) {
    const res=await post(bad);
    assert.equal(res.status,400);
    assert.ok((await res.json()).code,'a machine-readable code comes back');
  }
  const bogus=await fetch(base,{method:'PUT'});assert.equal(bogus.status,405);

  await new Promise(resolve=>app.server.close(resolve));app.wss.close();
});

test('battle rooms start with personalized snapshots and server-validated targeting', async () => {
  const app=createServer();await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const port=app.server.address().port,url=`ws://127.0.0.1:${port}/ws`;
  const a=client(url),b=client(url);await Promise.all([a.opened,b.opened]);
  a.send({type:'create',name:'Alpha'});const aj=await a.next('joined');
  b.send({type:'join',code:aj.room.code,name:'Bravo'});await b.next('joined');
  a.send({type:'update_settings',revision:0,settings:{...aj.room.settings,mode:'battle'}});
  await nextWhere(a,'lobby_state',m=>m.room.settings.mode==='battle');a.send({type:'start'});
  const [as,bs]=await Promise.all([a.next('match_started'),b.next('match_started')]);
  assert.equal(as.snapshot.kind,'battle');assert.equal(bs.snapshot.kind,'battle');
  assert.equal(as.snapshot.self.players[0].id,as.snapshot.boards.find(p=>p.name==='Alpha').id);
  assert.equal(bs.snapshot.self.players[0].id,bs.snapshot.boards.find(p=>p.name==='Bravo').id);
  a.send({type:'target',targetId:bs.snapshot.self.players[0].id});const error=await a.next('error');assert.equal(error.code,'no_attack');
  a.ws.terminate();b.ws.terminate();app.wss.close();await new Promise(resolve=>app.server.close(resolve));
});
