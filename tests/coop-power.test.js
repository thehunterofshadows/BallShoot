'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocket } = require('ws');
const { OnlineGame, TEAM_POWER, POWERS, powerCharge, powerPair } = require('../server/game');
const { BattleGame } = require('../server/battle');
const { DEFAULT_SETTINGS } = require('../server/lobbies');
const { createServer } = require('../server/server');

const root = path.resolve(__dirname, '..');
const duo = [{ id:'a', name:'Ada' }, { id:'b', name:'Ben' }];
const C = TEAM_POWER.charge, BURST = POWERS.synergy;

// A hand-built two-player Co-op Clear board, as in coop-team.test.js.
const board = (roster = duo, settings = {}) => {
  const game = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:0, ...settings }, roster, 9);
  game.grid = new Map(); game.batch = []; game.events = [];
  game.put = (r, c, kind, placedBy = -1, at = 0) => { const b = { r, c, kind, special:null, placedBy, at }; game.grid.set(`${r},${c}`, b); return b; };
  game.put(0, 10, 'Y');
  game.shoot = (shooter, r, c, kind, fired = 5) => {
    const b = game.put(r, c, kind, shooter, fired + 0.3); b.fired = fired;
    game.batch.push(b); game.now = fired + 0.3; game.resolveBatch();
  };
  game.powerEvents = kind => game.events.filter(e => e.kind === kind).map(e => e.data);
  return game;
};
const cutColumn = (game, owner, length) => {
  game.put(0, 3, 'R'); game.put(0, 4, 'R');
  for (let r = 1; r <= length; r++) game.put(r, 3, 'GBY'[r % 3], owner, 1);
};
const full = (game = board()) => { game.teamPowerCharge = TEAM_POWER.max; return game; };

test('a setup assist charges the meter once per resolved event, not per bubble', () => {
  const game = board();
  for (let c = 0; c < 6; c++) game.put(0, c, 'B', 0, 1);
  game.shoot(1, 0, 6, 'B');
  assert.equal(game.teamPowerCharge, C.assist);
  const [ev] = game.powerEvents('team_power_charge');
  assert.deepEqual(ev.reasons, ['assist']);
  assert.equal(ev.charge, C.assist);
});

test('an alternating team chain step charges; the opening clear does not', () => {
  const game = board();
  game.put(0, 0, 'R'); game.put(0, 1, 'R');
  game.shoot(0, 0, 2, 'R');
  assert.equal(game.teamPowerCharge, 0, 'a clear of the starting board with no teammate involvement');
  game.put(0, 5, 'G'); game.put(0, 6, 'G');
  game.shoot(1, 0, 7, 'G', 6);
  assert.equal(game.teamPowerCharge, C.chain, 'the handoff');
  game.put(0, 3, 'B'); game.put(1, 3, 'B');
  game.shoot(1, 0, 4, 'B', 7);
  assert.equal(game.teamPowerCharge, C.chain, 'the same player again is not a chain step');
});

test('team drops and huge team drops charge by size', () => {
  const drop = board();
  cutColumn(drop, 0, 6);
  drop.shoot(1, 0, 5, 'R');
  assert.equal(drop.teamPowerCharge, C.assist + C.drop);
  assert.deepEqual(drop.powerEvents('team_power_charge')[0].reasons, ['assist', 'drop']);
  const huge = board();
  cutColumn(huge, 0, 10);
  huge.shoot(1, 0, 5, 'R');
  assert.equal(huge.teamPowerCharge, C.assist + C.hugeDrop);
});

test('a team rescue charges', () => {
  const game = board();
  cutColumn(game, 0, 15);
  game.danger = { t:2, max:4 };
  game.shoot(1, 0, 5, 'R');
  assert.deepEqual(game.powerEvents('team_power_charge')[0].reasons, ['assist', 'rescue', 'hugeDrop']);
  assert.equal(game.teamPowerCharge, C.assist + C.rescue + C.hugeDrop);
});

test('solo-style clears never charge: own bubbles, starting board, an unassisted drop', () => {
  const own = board();
  own.put(0, 0, 'R', 1, 1); own.put(0, 1, 'R', 1, 2);
  own.shoot(1, 0, 2, 'R');
  const start = board();
  cutColumn(start, -1, 12);
  start.shoot(1, 0, 5, 'R');
  for (const game of [own, start]) {
    assert.equal(game.teamPowerCharge, 0);
    assert.equal(game.powerEvents('team_power_charge').length, 0);
  }
});

test('charge caps at 100 and announces READY exactly once', () => {
  const game = board();
  game.teamPowerCharge = TEAM_POWER.max - 5;
  cutColumn(game, 0, 10);
  game.shoot(1, 0, 5, 'R');
  assert.equal(game.teamPowerCharge, TEAM_POWER.max);
  assert.equal(game.powerEvents('team_power_charge')[0].amount, 5, 'the event reports what was actually added');
  assert.equal(game.powerEvents('team_power_ready').length, 1);
  game.put(0, 0, 'G', 0, 1); game.put(0, 1, 'G', 0, 1);
  game.shoot(1, 0, 2, 'G', 6);
  assert.equal(game.teamPowerCharge, TEAM_POWER.max);
  assert.equal(game.powerEvents('team_power_ready').length, 1, 'a full meter does not re-announce');
});

test('activation below 100 is rejected and costs nothing', () => {
  const game = board();
  game.teamPowerCharge = TEAM_POWER.max - 1;
  assert.equal(game.activateTeamPower('a'), false);
  assert.equal(game.teamPowerCharge, TEAM_POWER.max - 1);
  assert.equal(game.teamPowerActive, null);
  assert.equal(game.powerEvents('team_power_activated').length, 0);
});

test('either human can activate at 100; the meter empties and both loaded bubbles turn rainbow', () => {
  for (const [id, by] of [['a', 0], ['b', 1]]) {
    const game = full();
    game.players[0].cur = { kind:'R', special:null }; game.players[1].cur = { kind:'B', special:'bomb' };
    game.players[0].next = { kind:'G', special:null };
    assert.equal(game.activateTeamPower(id), true);
    assert.equal(game.teamPowerCharge, 0);
    assert.equal(game.teamPowerActive, 'synergy');
    assert.equal(game.teamPowerTimer, BURST.secs);
    assert.deepEqual(game.players.map(p => p.cur.special), ['rainbow', 'rainbow']);
    assert.deepEqual(game.players[0].next, { kind:'G', special:null }, 'the next bubble is untouched');
    const [ev] = game.powerEvents('team_power_activated');
    assert.equal(ev.by, by);
    assert.deepEqual(ev.players, [0, 1]);
    assert.equal(ev.secs, BURST.secs);
  }
});

test('two requests in the same instant fire the power once', () => {
  const game = full();
  assert.deepEqual([game.activateTeamPower('a'), game.activateTeamPower('b')], [true, false]);
  assert.equal(game.powerEvents('team_power_activated').length, 1);
  assert.equal(game.teamPowerTimer, BURST.secs, 'the second request did not restart the timer');
});

test('no activation while paused, between levels, or for a stranger', () => {
  const paused = full(); paused.setPaused(true);
  assert.equal(paused.activateTeamPower('a'), false);
  const between = full(); between.state = 'levelup';
  assert.equal(between.activateTeamPower('a'), false);
  assert.equal(full().activateTeamPower('nobody'), false);
  const gone = full(); gone.setConnected('a', false);
  assert.equal(gone.activateTeamPower('a'), false);
  assert.equal(gone.activateTeamPower('b'), true, 'the connected partner still can');
  assert.equal(powerPair(TEAM_POWER, [0, 1], [{}, { bot:true }], 1, 'play', 100, null), null, 'a bot never activates');
});

test('the burst holds shot pressure, the miss meter and the rescue clock, then resumes from there', () => {
  const game = board(duo, { pressureShots:8 });
  game.pressure = 7; game.missMeter = 2; game.danger = { t:1.5, max:4 };
  cutColumn(game, -1, 15); // an anchored column past the danger line, so the danger stays
  full(game).activateTeamPower('a');
  game.players[0].reload = 0;
  game.fire('a');
  assert.equal(game.pressure, 7, 'a shot during the burst adds no pressure');
  game.flights = [];
  game.shoot(0, 0, 0, 'G', 6); // a lone bubble: no match
  assert.equal(game.missMeter, 2, 'a miss during the burst does not fill the meter');
  game.pressure = 9;
  for (let t = 0; t < BURST.secs - 0.5; t += 0.05) game.update(0.05);
  assert.equal(game.state, 'play');
  assert.equal(game.danger.t, 1.5, 'the rescue clock stood still');
  assert.equal(game.pressure, 9, 'the ceiling did not come down');
  const anchor = game.anchorRow;
  for (let i = 0; i < 12; i++) game.update(0.05);
  assert.equal(game.teamPowerActive, null);
  assert.equal(game.powerEvents('team_power_ended').length, 1);
  assert.ok(game.anchorRow > anchor, 'pressure resumes the moment the burst ends');
  assert.ok(game.danger.t < 1.5 && game.danger.t > 1, 'and so does the rescue clock, from where it stopped');
});

test('the meter does not charge while the burst runs', () => {
  const game = full();
  game.activateTeamPower('a');
  game.put(0, 0, 'R', 0, 1); game.put(0, 1, 'R', 0, 1);
  game.shoot(1, 0, 2, 'R');
  assert.equal(game.teamPowerCharge, 0);
  assert.equal(powerCharge(TEAM_POWER, { assists:[{}], rescue:null, drop:null }, 1, 'synergy').amount, 0);
});

test('snapshots carry the meter and the running burst for a rejoining player', () => {
  const game = board();
  game.teamPowerCharge = 45;
  let snap = JSON.parse(JSON.stringify(game.snapshotFor('a', true)));
  assert.equal(snap.teamPowerOn, true);
  assert.equal(snap.teamPowerCharge, 45);
  assert.equal(snap.teamPowerMax, TEAM_POWER.max);
  assert.equal(snap.teamPowerActive, null);
  full(game).activateTeamPower('b');
  game.update(0.05); game.update(0.05);
  snap = JSON.parse(JSON.stringify(game.snapshotFor('b', true)));
  assert.equal(snap.teamPowerActive, 'synergy');
  assert.equal(snap.teamPowerCharge, 0);
  assert.ok(snap.teamPowerTimer < BURST.secs && snap.teamPowerTimer > BURST.secs - 0.2);
  assert.equal(snap.teamPowerSecs, BURST.secs);
  assert.deepEqual(snap.players.map(p => p.cur.special), ['rainbow', 'rainbow']);
  assert.ok(snap.events.some(e => e.kind === 'team_power_activated'));
});

test('the meter carries into the next level; a running burst does not', () => {
  const game = board();
  game.teamPowerCharge = 60;
  game.startNextLevel();
  assert.equal(game.teamPowerCharge, 60);
  full(game).activateTeamPower('a');
  game.startNextLevel();
  assert.equal(game.teamPowerActive, null);
  assert.equal(game.teamPowerCharge, 0);
});

test('solo, endless, three players and battle never gain or use Team Power', () => {
  const solo = board([duo[0]]);
  solo.put(0, 0, 'R', 0, 1); solo.put(0, 1, 'R', 0, 1);
  solo.shoot(0, 0, 2, 'R');
  assert.equal(solo.teamPowerCharge, 0);
  assert.equal(full(solo).activateTeamPower('a'), false);
  assert.equal(solo.snapshot().teamPowerOn, false);

  const endless = board(duo, { mode:'endless' });
  cutColumn(endless, 0, 10);
  endless.shoot(1, 0, 5, 'R');
  assert.equal(endless.teamPowerCharge, 0);
  assert.equal(full(endless).activateTeamPower('a'), false);

  const three = board([...duo, { id:'c', name:'Cy' }]);
  cutColumn(three, 0, 10);
  three.shoot(1, 0, 5, 'R');
  assert.equal(three.teamPowerCharge, 0);

  const battle = new BattleGame({ ...DEFAULT_SETTINGS, mode:'battle' }, duo, 4);
  assert.equal(typeof battle.activateTeamPower, 'undefined', 'battle has no Team Power at all');
  for (const { game } of battle.boards) {
    game.teamPowerCharge = TEAM_POWER.max;
    assert.equal(game.activateTeamPower(game.players[0].id), false);
  }
});

test('the power rules are byte-identical in the server and the client', () => {
  const block = file => {
    const m = fs.readFileSync(path.join(root, file), 'utf8').match(/\/\* power-rules:begin[\s\S]*?\/\* power-rules:end \*\//);
    assert.ok(m, 'power-rules block missing in ' + file);
    return m[0];
  };
  assert.equal(block('coop-bubbles.js'), block('server/game.js'));
});

test('the client asks the server for the power and renders what comes back', () => {
  const client = fs.readFileSync(path.join(root, 'coop-bubbles.js'), 'utf8');
  const request = client.match(/requestTeamPower\(i\) \{[\s\S]*?\n  \}/)[0];
  assert.match(request, /if \(this\.online\) \{ this\.sendOnline\('team_power'\); return; \}/);
  assert.ok(request.indexOf("sendOnline('team_power')") < request.indexOf('def.start('), 'online returns before any effect');
  for (const kind of ['team_power_charge', 'team_power_ready', 'team_power_activated', 'team_power_ended'])
    assert.ok(client.includes(`e.kind==='${kind}'`), kind + ' is rendered');
  assert.match(client, /this\.teamPowerCharge=s\.teamPowerCharge\|\|0;/);
  assert.match(client, /class="padT"/);
  assert.match(client, /k === 'q'/);
});

function client(url){
  const ws=new WebSocket(url),queue=[],waiters=[];
  ws.on('message',raw=>{const msg=JSON.parse(raw);const i=waiters.findIndex(w=>w.type===msg.type);if(i>=0)waiters.splice(i,1)[0].resolve(msg);else queue.push(msg);});
  const opened=new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  return {ws,opened,send(value){ws.send(JSON.stringify(value));},next(type){const i=queue.findIndex(m=>m.type===type);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timed out waiting for ${type}`)),2500);waiters.push({type,resolve:m=>{clearTimeout(timer);resolve(m);}});});}};
}

test('over the socket client-supplied charge is ignored and simultaneous requests fire once', async () => {
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
    a.send({type:'team_power',charge:100,power:'synergy'});
    await new Promise(r=>setTimeout(r,60));
    assert.equal(game.teamPowerActive,null,'an empty meter cannot be talked into firing');
    game.teamPowerCharge=TEAM_POWER.max;
    a.send({type:'team_power'});b.send({type:'team_power'});
    for(let i=0;i<40&&!game.events.some(e=>e.kind==='team_power_activated');i++)await new Promise(r=>setTimeout(r,10));
    await new Promise(r=>setTimeout(r,50));
    assert.equal(game.events.filter(e=>e.kind==='team_power_activated').length,1);
    let snap;for(let i=0;i<8;i++){snap=(await b.next('snapshot')).snapshot;if(snap.teamPowerActive)break;}
    assert.equal(snap.teamPowerActive,'synergy','the partner sees the burst');
    assert.equal(snap.teamPowerCharge,0);
  } finally {
    a.ws.terminate();b.ws.terminate();app.wss.close();await new Promise(resolve=>app.server.close(resolve));
  }
});
