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
