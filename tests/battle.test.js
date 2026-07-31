'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BattleGame } = require('../server/battle');
const { DEFAULT_SETTINGS } = require('../server/lobbies');

const settings = { ...DEFAULT_SETTINGS, mode:'battle', field:'wide' };
const roster = [{id:'a',name:'Ada'},{id:'b',name:'Ben'},{id:'c',name:'Cy'}];

test('seeded battle games produce identical private boards', () => {
  const a=new BattleGame(settings,roster,1234),b=new BattleGame(settings,roster,1234);
  a.input('a',{r:true});b.input('a',{r:true});
  for(let i=0;i<30;i++){a.update(1/60);b.update(1/60);}
  a.fire('a');b.fire('a');for(let i=0;i<180;i++){a.update(1/60);b.update(1/60);}
  assert.deepEqual(a.snapshotFor('a',true),b.snapshotFor('a',true));
  assert.equal(a.boards[0].game.WW,640);
});

test('attacks stack, validate their target, and add authoritative garbage', () => {
  const game=new BattleGame(settings,roster,2),before=game.board('b').game.grid.size;
  game.charge('a',5);game.charge('a',4);
  assert.equal(game.snapshotFor('a').pendingTarget.amount,9);
  assert.throws(()=>game.target('a','a'),e=>e.code==='invalid_target');
  assert.equal(game.snapshotFor('a').pendingTarget.amount,9);
  game.target('a','b');
  assert.equal(game.snapshotFor('a').pendingTarget,null);
  assert.ok(game.board('b').game.grid.size>before);
  assert.equal(game.board('a').game.players[0].stats.attacks,1);
});

test('a six-bubble clear charges an attack and refills an empty battle field', () => {
  const game=new BattleGame(settings,roster,12),board=game.board('a').game;
  board.grid=new Map();for(let c=0;c<6;c++)board.grid.set(`0,${c}`,{r:0,c,kind:'R',special:null,placedBy:c===5?0:-1});
  board.batch=[board.grid.get('0,5')];board.resolveBatch();
  assert.equal(game.snapshotFor('a').pendingTarget.amount,6);
  // 6 popped = 60 base + 90 group-size bonus, plus the 1000 empty-field refill.
  assert.ok(board.grid.size>6);assert.equal(board.score,1150);
});

test('expired targeting chooses a living opponent deterministically', () => {
  const a=new BattleGame(settings,roster,99),b=new BattleGame(settings,roster,99);
  a.charge('a',6);b.charge('a',6);for(let i=0;i<361;i++){a.update(1/60);b.update(1/60);}
  assert.equal(a.pending.has('a'),false);assert.deepEqual(a.snapshotFor('a',true),b.snapshotFor('a',true));
});

test('disconnects idle indefinitely while explicit forfeits determine placement', () => {
  const game=new BattleGame(settings,roster,8);game.setConnected('a',false);
  assert.equal(game.fire('a'),false);for(let i=0;i<600;i++)game.update(1/60);
  assert.equal(game.board('a').alive,true);
  game.forfeit('a');assert.equal(game.board('a').place,3);game.forfeit('b');
  assert.equal(game.state,'ended');assert.equal(game.winnerId,'c');assert.equal(game.board('c').place,1);
  assert.equal(game.snapshotFor('a').state,'lost');assert.equal(game.snapshotFor('c').state,'won');
});

test('simultaneous eliminations do not award a false winner', () => {
  const game=new BattleGame(settings,roster.slice(0,2),18);
  game.boards.forEach(b=>{b.game.state='lost';});game.update(1/60);
  assert.equal(game.state,'ended');assert.equal(game.winnerId,null);
  assert.equal(game.order.length,2);assert.equal(game.boards.every(b=>!b.alive),true);
});

test('battle snapshots separate full self state from periodic arena previews', () => {
  const game=new BattleGame(settings,roster,11),regular=game.snapshotFor('a',false),overview=game.snapshotFor('a',true);
  assert.equal(regular.kind,'battle');assert.ok(regular.self.grid.length);assert.equal(regular.overview,undefined);
  assert.equal(regular.boards.length,3);assert.equal(overview.overview.length,3);
  assert.ok(!('grid' in regular.boards[1]));assert.ok(overview.overview[1].grid.length);
});

test('battle previews include enough motion and launcher state to animate between overviews', () => {
  const game=new BattleGame(settings,roster,21);game.fire('b');
  const ben=game.snapshotFor('a',true).overview.find(board=>board.id==='b');
  assert.ok(ben.player);assert.equal(Number.isFinite(ben.player.x),true);assert.ok(ben.player.cur);
  assert.equal(ben.flights.length,1);assert.equal(Number.isFinite(ben.flights[0].vx),true);assert.equal(Number.isFinite(ben.flights[0].vy),true);
});
