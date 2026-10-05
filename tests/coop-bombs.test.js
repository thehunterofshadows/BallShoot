'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { OnlineGame, TEAM_POWER } = require('../server/game');
const { DEFAULT_SETTINGS } = require('../server/lobbies');
const roster = [{id:'a',name:'Ada'}, {id:'b',name:'Ben'}];
const room = settings => new OnlineGame({...DEFAULT_SETTINGS, mode:'clear', level:0, ...settings}, roster, 9);
const client = fs.readFileSync('coop-bubbles.js','utf8');
const block = source => source.match(/\/\* bomb-reserve:begin[\s\S]*?\/\* bomb-reserve:end \*\//)[0];

test('local and authority share bomb rules; repeated toggling preserves both bubbles and inventory', () => {
  assert.equal(block(client), block(fs.readFileSync('server/game.js','utf8')));
  const {bombToggle} = vm.runInNewContext(block(client) + '; ({bombToggle})');
  const p = {cur:{kind:'G',special:'rainbow'}, next:{kind:'B'}, bombs:3, reload:0};
  const cur = p.cur, next = p.next;
  for (let i=0;i<50;i++) {
    assert.equal(bombToggle(p),true);
    assert.equal(p.bombs,2); assert.equal(p.bombStored,cur); assert.equal(p.cur.special,'bomb');
    assert.equal(bombToggle(p),true);
    assert.equal(p.bombs,3); assert.equal(p.cur,cur); assert.equal(p.next,next); assert.equal(p.bombStored,null);
  }
});

test('bomb firing restores the stored bubble without advancing the queue, consumes exactly one, and uses normal flights', () => {
  const g = room(), p = g.players[0], cur = p.cur, next = p.next, generated = g.shotCount;
  assert.equal(g.requestBombToggle('a'),true);
  assert.equal(g.requestPass('a'),false,'reserve bomb cannot be transferred');
  assert.equal(g.fire('a'),true);
  assert.equal(g.flights[0].special,'bomb'); assert.equal(g.flights[0].p,0);
  assert.equal(p.bombs,2); assert.equal(p.bombLoaded,false); assert.equal(p.bombStored,null);
  assert.equal(p.cur,cur); assert.equal(p.next,next); assert.equal(g.shotCount,generated);
  assert.equal(g.requestBombToggle('a'),false,'reload is not ready');
  p.reload=0; assert.equal(g.fire('a'),true); assert.equal(p.cur,next);
  assert.equal(g.players[1].bombs,3);
});

test('empty reserve feedback changes no gameplay state; invalid gameplay states refuse toggles', () => {
  const g=room(), p=g.players[0];
  for(let i=0;i<3;i++){p.reload=0;g.requestBombToggle('a');g.fire('a');}
  p.reload=0;
  const before=JSON.stringify({...g.snapshot(),events:[],eventId:0});
  assert.equal(g.requestBombToggle('a'),false);
  assert.equal(JSON.stringify({...g.snapshot(),events:[],eventId:0}),before);
  assert.equal(g.events.at(-1).kind,'bomb_empty');
  assert.equal(g.requestBombToggle('stranger'),false);
  const fresh=room();
  fresh.setPaused(true);assert.equal(fresh.requestBombToggle('a'),false);
  fresh.setPaused(false);fresh.setConnected('a',false);assert.equal(fresh.requestBombToggle('a'),false);
  fresh.setConnected('a',true);fresh.state='levelup';assert.equal(fresh.requestBombToggle('a'),false);
  assert.equal(room({mode:'endless'}).requestBombToggle('a'),false);
});

test('snapshots retain owned loaded bombs; queue refresh and Team Power operate on the stored bubble', () => {
  const g=room(), p=g.players[0];p.cur={kind:'O',special:null};
  g.requestBombToggle('a');
  g.grid.clear();g.grid.set('0,0',{r:0,c:0,kind:'G',special:null});g.refreshQueues();
  assert.equal(p.cur.special,'bomb');assert.equal(p.bombStored.kind,'G');
  g.teamPowerCharge=TEAM_POWER.max;assert.equal(g.activateTeamPower('a'),true);
  assert.equal(p.cur.special,'bomb');assert.equal(p.bombStored.special,'rainbow');
  const wire=JSON.parse(JSON.stringify(g.snapshotFor('a'))).players[0];
  assert.equal(wire.bombs,2);assert.equal(wire.bombLoaded,true);assert.equal(wire.bombStored.special,'rainbow');
  g.requestBombToggle('a');assert.equal(p.cur.special,'rainbow');assert.equal(p.bombs,3);
});

test('clear bonus counts loaded unused bombs, banks the team total, and resets every round', () => {
  const g=room();g.requestBombToggle('a');const before=g.score, bonus=g.levelBonus();
  g.clearLevel();assert.equal(g.levelSummary.bombBonus,1500);
  assert.equal(g.score,before+bonus+g.levelSummary.timeBonus+1500);
  assert.equal(g.levelSummary.players[0].bombLoaded,true);
  g.startNextLevel();assert.deepEqual(g.players.map(p=>[p.bombs,p.bombLoaded,p.bombStored]),[[3,false,null],[3,false,null]]);
  g.requestBombToggle('a');g.fire('a');g.clearLevel();assert.equal(g.levelSummary.bombBonus,1250);
  g.reset();assert.deepEqual(g.players.map(p=>p.bombs),[3,3]);
  const final=room({level:51});final.clearLevel();assert.equal(final.state,'won');
  assert.equal(final.events.find(e=>e.kind==='level_cleared').data.bombBonus,1500);
});
