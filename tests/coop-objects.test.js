'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Rules = require('../coop-objects');
const {OnlineGame,LEVELS} = require('../server/game');
const {DEFAULT_SETTINGS} = require('../server/lobbies');
const lobbies = require('../server/lobbies');

const duo = [{id:'a',name:'Ada'},{id:'b',name:'Ben'}];
const game = (level, roster = duo, mode = 'clear') =>
  new OnlineGame({...DEFAULT_SETTINGS,mode,level,hurry:0,pressureShots:0},roster,41);
const obj = (g,id) => g.objects.find(o => o.id === `${id}_0`);
const event = (g,kind) => g.events.filter(e => e.kind === kind).map(e => e.data);
const hit = (g,o,player) => {
  const [r,c] = o.cells[0];
  g.land({x:g.cellX(r,c),y:g.cellY(r),p:player,kind:'R',special:null,at:g.now});
};
const advance = (g,seconds) => { for (let i=0;i<seconds*20;i++) g.update(.05); };

test('authored schema is valid and rejects duplicate ids, missing targets, bad links and invalid requirements', () => {
  LEVELS.forEach(L => assert.equal(Rules.validate(L),true));
  const copy = structuredClone(LEVELS[48]); copy.objects[1].id = copy.objects[0].id;
  assert.throws(() => Rules.validate(copy), /duplicate/);
  copy.objects[1].id = 'eastLock'; copy.objects[0].cells = [[99,0]];
  assert.throws(() => Rules.validate(copy), /invalid cell/);
  copy.objects[0].cells = [[10,0]]; copy.objects[0].pair = 'missing';
  assert.throws(() => Rules.validate(copy), /invalid pair/);
  copy.objects[0].pair = 'eastLock'; copy.objects[0].requiredPlayers = 5;
  assert.throws(() => Rules.validate(copy), /player requirement/);
  copy.objects[0].requiredPlayers = undefined; copy.objects[1].cells = [[10,0]];
  assert.throws(() => Rules.validate(copy), /duplicate object target/);
  copy.objects[1].cells = [[10,9]]; copy.objects[0].barrier = [[7,3]];
  assert.throws(() => Rules.validate(copy), /shared unlockable barrier/);
  const shield = structuredClone(LEVELS[47]); shield.objects[0].barrier = [[8,1]];
  assert.throws(() => Rules.validate(shield), /no barrier unlock source/);
});

test('the late set pieces load progressively; solo, Battle and custom omit co-op objects', () => {
  assert.equal(game(46).objects.length,0);
  assert.deepEqual(game(47).objects.map(o=>o.type),['shield','shield']);
  assert.deepEqual(game(48).objects.map(o=>o.type),['syncLock','syncLock']);
  assert.deepEqual(game(49).objects.map(o=>o.type),['teamArmor','teamArmor','corruption']);
  assert.equal(game(47,[duo[0]]).objects.length,0);
  const battle=game(47,duo,'battle');
  assert.equal(battle.objects.length,0);
  battle.objects=game(47).objects; // a client can retain stale co-op state while changing modes
  assert.equal(Rules.protectedCell(battle,'8,0'),false);
  assert.equal(Rules.hit(battle,battle.cellX(8,0),battle.cellY(8)),null);
  assert.equal(game('custom').objects.length,0);
});

test('shield protects its bubble, records the breaker, then rewards a teammate once', () => {
  const g = game(47), o = obj(g,'leftShield'), cell = o.cells[0].join(',');
  assert.equal(Rules.hit(g,g.cellX(8,0)+35,g.cellY(8)),null,'the closer ordinary bubble receives the hit');
  assert.equal(Rules.protectedCell(g,cell),true);
  hit(g,o,0);
  assert.equal(o.state,'exposed'); assert.equal(o.by,0);
  assert.equal(g.grid.has(cell),true); assert.equal(Rules.protectedCell(g,cell),false);
  const score = g.score;
  hit(g,o,1);
  assert.equal(o.state,'done'); assert.equal(g.grid.has(cell),false);
  assert.equal(g.score,score+150);
  assert.equal(event(g,'object_complete').at(-1).cooperative,true);
  assert.ok(g.teamPowerCharge>0);
});

test('same-player shield clear gives no co-op bonus and expiry restores protection', () => {
  const g = game(47), o = obj(g,'leftShield');
  hit(g,o,0); advance(g,7);
  assert.equal(o.state,'ready'); assert.equal(o.by,null);
  hit(g,o,0); hit(g,o,0);
  assert.equal(o.state,'done'); assert.equal(event(g,'object_complete').at(-1).cooperative,false);
  assert.equal(g.teamPowerCharge,0);
});

test('an exposed shield can join an ordinary teammate match, but an intact shield cannot pop', () => {
  const makeShot = g => {
    const b={r:9,c:0,kind:'O',special:null,placedBy:1,at:g.now,fired:g.now};
    g.grid.set('9,0',b); g.batch.push(b); g.resolveBatch();
  };
  const intact=game(47), first=obj(intact,'leftShield');
  makeShot(intact);
  assert.ok(!event(intact,'pop').some(e => e.bubbles.some(b => `${b.r},${b.c}` === first.cells[0].join(','))));
  const exposed=game(47), second=obj(exposed,'leftShield');
  hit(exposed,second,0); makeShot(exposed);
  assert.equal(second.state,'done');
  assert.equal(event(exposed,'object_complete').at(-1).cooperative,true);
});

test('sync locks require two players inside five seconds and open both barriers', () => {
  const g=game(48), a=obj(g,'westLock'), b=obj(g,'eastLock');
  hit(g,a,0); hit(g,b,0);
  assert.notEqual(a.state,'open'); assert.notEqual(b.state,'open');
  advance(g,6); assert.equal(a.state,'ready'); assert.equal(b.state,'ready');
  hit(g,b,0); hit(g,a,1);
  assert.equal(a.state,'open'); assert.equal(b.state,'open');
  for (const cell of [...a.cells,...b.cells,...a.barrier]) assert.equal(g.grid.has(cell.join(',')),false);
  assert.equal(event(g,'object_complete').length,1);
  assert.equal(event(g,'object_complete')[0].cooperative,true);
});

test('armor needs distinct contributors; disconnected teammate enables a safe fallback', () => {
  const g=game(49), o=obj(g,'westArmor');
  hit(g,o,0); hit(g,o,0);
  assert.equal(o.state,'marked'); assert.deepEqual(o.contributors,[0]);
  hit(g,o,1);
  assert.equal(o.state,'done'); assert.equal(event(g,'object_complete').at(-1).cooperative,true);
  const alone=game(49), armor=obj(alone,'eastArmor');
  hit(alone,armor,0); alone.setConnected('b',false); advance(alone,11);
  assert.equal(alone.objectFallback,true);
  hit(alone,armor,0);
  assert.equal(armor.state,'done'); assert.equal(event(alone,'object_complete').at(-1).cooperative,false);
  const returned=game(49), remaining=obj(returned,'eastArmor');
  returned.setConnected('b',false); advance(returned,11);
  returned.setConnected('b',true);
  assert.equal(returned.objectFallback,false);
  hit(returned,remaining,0); hit(returned,remaining,1);
  assert.equal(event(returned,'object_complete').at(-1).cooperative,true);
});

test('disconnect holds a sync timer during reconnect grace; fallback avoids a permanent lock', () => {
  const g=game(48), a=obj(g,'westLock'), b=obj(g,'eastLock');
  hit(g,a,0); g.setConnected('b',false); advance(g,6);
  assert.equal(a.state,'armed'); assert.ok(a.timer>0);
  g.setConnected('b',true); hit(g,b,1);
  assert.equal(a.state,'open');
  const alone=game(48), west=obj(alone,'westLock'), east=obj(alone,'eastLock');
  alone.setConnected('b',false); advance(alone,11);
  hit(alone,west,0); hit(alone,east,0);
  assert.equal(west.state,'open');
  assert.equal(event(alone,'object_complete').at(-1).cooperative,false);
});

test('corruption spreads deterministically at bounded shot intervals and stops when cleared', () => {
  const a=game(49), b=game(49), node=obj(a,'pressure');
  for (let i=0;i<25;i++) { Rules.shot(a); Rules.shot(b); }
  assert.deepEqual(node.spread,obj(b,'pressure').spread);
  assert.equal(node.spread.length,4);
  assert.equal(event(a,'object_spread').length,4);
  assert.ok(node.spread.every(c=>c[0]>=6 && c[0]<=10));
  hit(a,node,0); const count=node.spread.length;
  for (let i=0;i<10;i++) Rules.shot(a);
  assert.equal(node.spread.length,count);
});

test('snapshots retain object state, and a level transition rebuilds the next object set', () => {
  const g=game(47), shield=obj(g,'leftShield');
  hit(g,shield,0); const snapshot=structuredClone(g.snapshot());
  assert.equal(snapshot.objects[0].state,'exposed');
  assert.equal(snapshot.objects[0].by,0);
  assert.equal(snapshot.objects[0].timer,6);
  g.grid.clear(); g.batch=[]; g.resolveBatch();
  assert.equal(g.state,'levelup');
  g.levelReady('a'); g.levelReady('b');
  assert.equal(g.settings.level,48);
  assert.deepEqual(g.objects.map(o=>o.type),['syncLock','syncLock']);
  assert.ok(g.objects.every(o=>o.state==='ready'));
});

test('a room reconnect receives the live authoritative lock state and can finish the pair', () => {
  const socket = () => ({readyState:1,messages:[],send(text){this.messages.push(JSON.parse(text));}});
  const host=lobbies.create('Ada',socket(),'object-host'), guest=lobbies.join(host.room.code,'Ben',socket(),'object-guest');
  try {
    lobbies.updateSettings(host.room,host.p,{...host.room.settings,level:48,hurry:0,pressureShots:0},0);
    lobbies.start(host.room,host.p);
    const g=host.room.game, west=obj(g,'westLock');
    hit(g,west,0);
    lobbies.disconnect(host.room,guest.p,false);
    for(let i=0;i<120;i++)lobbies.tick(.05);
    assert.equal(west.state,'armed');
    const rejoined=lobbies.rejoin(host.room.code,guest.p.token,socket());
    const snapshot=g.snapshotFor(rejoined.p.id);
    assert.equal(snapshot.objects.find(o=>o.id===west.id).by,0);
    assert.ok(snapshot.objects.find(o=>o.id===west.id).timer>0);
    hit(g,obj(g,'eastLock'),1);
    assert.equal(west.state,'open');
  } finally {lobbies.clear();}
});

test('browser shell loads shared rules before the component and paints object overlays', () => {
  const root=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const client=fs.readFileSync(path.join(root,'coop-bubbles.js'),'utf8');
  assert.ok(html.indexOf('coop-objects.js') < html.indexOf('coop-bubbles.js'));
  assert.match(client,/this\.objects=s\.objects\|\|\[\]/);
  assert.match(client,/drawObjects\(ctx,vwL,vwR\)/);
});
