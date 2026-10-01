'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocket } = require('ws');
const { OnlineGame, PASS, passPair } = require('../server/game');
const { BattleGame } = require('../server/battle');
const { DEFAULT_SETTINGS } = require('../server/lobbies');
const { createServer } = require('../server/server');

const root = path.resolve(__dirname, '..');
const duo = [{ id:'a', name:'Ada' }, { id:'b', name:'Ben' }];
const trio = [...duo, { id:'c', name:'Cy' }];

// A two-player Co-op Clear room with known current and next bubbles.
const room = (roster = duo, settings = {}) => {
  const game = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:0, ...settings }, roster, 9);
  game.events = [];
  game.players[0].cur = { kind:'R', special:null }; game.players[0].next = { kind:'G', special:null };
  if (game.players[1]) { game.players[1].cur = { kind:'B', special:null }; game.players[1].next = { kind:'Y', special:null }; }
  game.passEvents = () => game.events.filter(e => e.kind === 'pass').map(e => e.data);
  return game;
};

test('P1 passes: the two current bubbles swap and the next bubbles stay put', () => {
  const game = room();
  assert.equal(game.requestPass('a'), true);
  assert.deepEqual(game.players[0].cur, { kind:'B', special:null });
  assert.deepEqual(game.players[1].cur, { kind:'R', special:null });
  assert.deepEqual(game.players[0].next, { kind:'G', special:null }, 'P1 next unchanged');
  assert.deepEqual(game.players[1].next, { kind:'Y', special:null }, 'P2 next unchanged');
  const [ev] = game.passEvents();
  assert.equal(ev.by, 0);
  assert.deepEqual(ev.players, [0, 1]);
  assert.deepEqual(ev.cur, [{ kind:'B', special:null }, { kind:'R', special:null }]);
  assert.equal(ev.cooldown, PASS.cooldown);
});

test('P2 passes exactly the same way', () => {
  const game = room();
  assert.equal(game.requestPass('b'), true);
  assert.equal(game.players[0].cur.kind, 'B');
  assert.equal(game.players[1].cur.kind, 'R');
  assert.equal(game.passEvents()[0].by, 1);
});

test('a bomb or rainbow travels with its bubble', () => {
  const game = room();
  game.players[0].cur = { kind:'R', special:'bomb' };
  game.players[1].cur = { kind:'R', special:'rainbow' };
  game.requestPass('a');
  assert.deepEqual(game.players[0].cur, { kind:'R', special:'rainbow' });
  assert.deepEqual(game.players[1].cur, { kind:'R', special:'bomb' });
});

test('a pass starts the shared cooldown, which refuses both players until it runs out', () => {
  const game = room();
  game.requestPass('a');
  assert.equal(game.passCd, PASS.cooldown);
  assert.equal(game.requestPass('a'), false, 'the passer is on cooldown');
  assert.equal(game.requestPass('b'), false, 'and so is the partner — the cooldown is shared');
  assert.equal(game.players[0].cur.kind, 'B', 'a refused pass swaps nothing');
  for (let t = 0; t < PASS.cooldown - 0.1; t += 0.05) game.update(0.05);
  assert.ok(game.passCd > 0);
  assert.equal(game.requestPass('b'), false);
  for (let i = 0; i < 4; i++) game.update(0.05);
  assert.equal(game.passCd, 0);
  assert.equal(game.requestPass('b'), true, 'ready again once the cooldown has run');
  assert.equal(game.players[0].cur.kind, 'R');
});

test('two requests in the same instant make exactly one swap', () => {
  const game = room();
  const results = [game.requestPass('a'), game.requestPass('b')];
  assert.deepEqual(results, [true, false]);
  assert.equal(game.passEvents().length, 1);
  assert.equal(game.players[0].cur.kind, 'B', 'swapped once, not swapped back');
});

test('no pass outside cooperative Clear', () => {
  const endless = room(duo, { mode:'endless' });
  assert.equal(endless.requestPass('a'), false);
  assert.equal(endless.players[0].cur.kind, 'R');
  const three = room(trio);
  assert.equal(three.requestPass('a'), true, 'three players can pass to the next teammate');
  const solo = room([duo[0]]);
  assert.equal(solo.requestPass('a'), false);
  const battle = new BattleGame({ ...DEFAULT_SETTINGS, mode:'battle' }, duo, 9);
  assert.equal(typeof battle.requestPass, 'undefined', 'battle has no pass at all');
  assert.equal(passPair([0, 1], [{ cur:{} }, { cur:{} }], 2, 'play', 0), null, 'a non-member cannot pass');
});

test('no pass with a disconnected teammate, while paused, between levels or for a stranger', () => {
  const gone = room();
  gone.setConnected('b', false);
  assert.equal(gone.requestPass('a'), false);
  assert.equal(gone.requestPass('b'), false);
  const paused = room();
  paused.setPaused(true);
  assert.equal(paused.requestPass('a'), false);
  const between = room();
  between.state = 'levelup';
  assert.equal(between.requestPass('a'), false);
  const empty = room();
  empty.players[1].cur = null;
  assert.equal(empty.requestPass('a'), false);
  assert.equal(room().requestPass('nobody'), false);
  assert.equal(room().passEvents().length, 0);
});

test('a pass is not a shot, a miss, a score, pressure or a chain', () => {
  const game = room();
  game.chain = { mult:3, last:1, same:0, players:new Set([0, 1]), t:4 };
  game.missMeter = 2; game.pressure = 3;
  const before = { score:game.score, miss:game.missMeter, pressure:game.pressure, shotCount:game.shotCount,
    stats:game.players.map(p => ({ ...p.stats })), chain:{ ...game.chain, players:[...game.chain.players] },
    grid:game.grid.size, flights:game.flights.length, reload:game.players.map(p => p.reload) };
  game.requestPass('a');
  assert.equal(game.score, before.score);
  assert.equal(game.missMeter, before.miss);
  assert.equal(game.pressure, before.pressure);
  assert.equal(game.shotCount, before.shotCount, 'no bubble was generated');
  assert.deepEqual(game.players.map(p => p.stats), before.stats);
  assert.deepEqual({ ...game.chain, players:[...game.chain.players] }, before.chain);
  assert.equal(game.grid.size, before.grid);
  assert.equal(game.flights.length, before.flights);
  assert.deepEqual(game.players.map(p => p.reload), before.reload);
});

test('the snapshot a rejoining client gets carries the cooldown and the swapped bubbles', () => {
  const game = room();
  game.requestPass('b');
  game.update(1);
  const snap = JSON.parse(JSON.stringify(game.snapshotFor('a', true)));
  assert.ok(snap.passCd > 0 && snap.passCd < PASS.cooldown);
  assert.equal(snap.passMax, PASS.cooldown);
  assert.equal(snap.players[0].cur.kind, 'B');
  assert.equal(snap.players[1].cur.kind, 'R');
  assert.equal(snap.players[0].next.kind, 'G');
  assert.ok(snap.events.some(e => e.kind === 'pass'));
});

test('the pass rules are byte-identical in the server and the client', () => {
  const block = file => {
    const m = fs.readFileSync(path.join(root, file), 'utf8').match(/\/\* pass-rules:begin[\s\S]*?\/\* pass-rules:end \*\//);
    assert.ok(m, 'pass-rules block missing in ' + file);
    return m[0];
  };
  assert.equal(block('coop-bubbles.js'), block('server/game.js'));
});

test('the client asks the server for a pass and never predicts the swap', () => {
  const client = fs.readFileSync(path.join(root, 'coop-bubbles.js'), 'utf8');
  const request = client.match(/requestPass\(i, direction = 1\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(request.indexOf("this.sendOnline('pass', { direction })") < request.indexOf('passSwap('), 'online returns before swapping');
  assert.match(request, /if \(this\.online\) \{ this\.sendOnline\('pass', \{ direction \}\); return; \}/);
  assert.match(client, /e\.kind==='pass'\)\{this\.showPass\(d\);\}/);
  assert.match(client, /this\.passCd=s\.passCd\|\|0;/);
  assert.match(client, /class="padP"/);
});

function client(url){
  const ws=new WebSocket(url),queue=[],waiters=[];
  ws.on('message',raw=>{const msg=JSON.parse(raw);const i=waiters.findIndex(w=>w.type===msg.type);if(i>=0)waiters.splice(i,1)[0].resolve(msg);else queue.push(msg);});
  const opened=new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  return {ws,opened,send(value){ws.send(JSON.stringify(value));},next(type){const i=queue.findIndex(m=>m.type===type);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timed out waiting for ${type}`)),2500);waiters.push({type,resolve:m=>{clearTimeout(timer);resolve(m);}});});}};
}

test('over the socket both players may ask, a bubble in the request is ignored, and only one swap happens', async () => {
  const app=createServer();await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
  const a=client(url),b=client(url);await Promise.all([a.opened,b.opened]);
  try {
    a.send({type:'create',name:'Alpha'});const aj=await a.next('joined');
    b.send({type:'join',code:aj.room.code,name:'Bravo'});await b.next('joined');
    await a.next('lobby_state');
    a.send({type:'update_settings',revision:aj.room.revision,settings:{...aj.room.settings,mode:'clear',level:0}});
    await a.next('lobby_state');
    a.send({type:'start'});await Promise.all([a.next('match_started'),b.next('match_started')]);
    const game=require('../server/lobbies').rooms.get(aj.room.code).game;
    const [c0,c1]=game.players.map(p=>({...p.cur}));
    a.send({type:'pass',cur:{kind:'R',special:'bomb'}});b.send({type:'pass'});
    for(let i=0;i<40&&!game.events.some(e=>e.kind==='pass');i++)await new Promise(r=>setTimeout(r,10));
    await new Promise(r=>setTimeout(r,50));
    assert.equal(game.events.filter(e=>e.kind==='pass').length,1,'one swap for two near-simultaneous requests');
    assert.deepEqual(game.players[0].cur,c1);assert.deepEqual(game.players[1].cur,c0);
    let snap;for(let i=0;i<8;i++){snap=(await b.next('snapshot')).snapshot;if(snap.passCd>0)break;}
    assert.ok(snap.passCd>0,'partners see the shared cooldown');
  } finally {
    a.ws.terminate();b.ws.terminate();app.wss.close();await new Promise(resolve=>app.server.close(resolve));
  }
});
