'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OnlineGame, TEAM, teamPlay, PASS, TEAM_POWER } = require('../server/game');
const { DEFAULT_SETTINGS } = require('../server/lobbies');

const roster = n => Array.from({ length:n }, (_, i) => ({ id:String(i), name:'P' + (i + 1) }));
const game = (n, settings = {}) => new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', ...settings }, roster(n), 9);

test('three launchers occupy stable left, center and right positions on one board', () => {
  const g = game(3);
  assert.deepEqual(g.players.map(p => p.x), [g.WW / 6, g.WW / 2, g.WW * 5 / 6]);
  assert.equal(g.grid.size, game(2).grid.size);
  assert.deepEqual(g.teamHumans(), [0,1,2]);
});

test('shot and miss tolerance grow modestly with active co-op roster; duo and solo keep their pace', () => {
  const counts = [1,2,3,4].map(n => game(n));
  assert.equal(counts[0].shotsPerDrop(), counts[1].shotsPerDrop());
  assert.ok(counts[2].shotsPerDrop() > counts[1].shotsPerDrop());
  assert.ok(counts[2].shotsPerDrop() < counts[1].shotsPerDrop() * 1.5);
  assert.ok(counts[3].shotsPerDrop() >= counts[2].shotsPerDrop());
  assert.equal(counts[1].missLimit(), DEFAULT_SETTINGS.missMax);
  assert.ok(counts[2].missLimit() > counts[1].missLimit());
  assert.ok(counts[3].missLimit() > counts[2].missLimit());
  counts[2].setConnected('2', false);
  assert.equal(counts[2].shotsPerDrop(), counts[1].shotsPerDrop(), 'pressure follows active humans');
  assert.equal(counts[2].missLimit(), counts[1].missLimit());
  const endlessDuo = game(2, { mode:'endless' }), endlessTrio = game(3, { mode:'endless' });
  assert.ok(endlessTrio.shotsPerDrop() > endlessDuo.shotsPerDrop());
});

test('two setup players and a third clearer receive a distinct flat triple assist bonus', () => {
  const shots = [{ shooter:2, at:5, bubbles:[
    { placedBy:0, at:1 }, { placedBy:1, at:2 }, { placedBy:0, at:3 },
  ] }];
  const result = teamPlay(TEAM, [0,1,2], shots, [], false);
  assert.deepEqual(result.assists, [{ by:2, setup:[0,1] }]);
  assert.equal(result.bonus, TEAM.assistBonus + TEAM.tripleBonus);
  assert.equal(teamPlay(TEAM, [0,1,2], [{ shooter:2, at:5, bubbles:[{ placedBy:0, at:6 }, { placedBy:1, at:7 }] }], [], false).bonus, 0);
});

test('any third contributor finishes a chain once and the active contributors remain visible in snapshots', () => {
  for (const order of [[0,2,1], [2,0,1]]) {
    const g = game(3);
    order.forEach(i => g.registerClear(i));
    assert.deepEqual(new Set(g.snapshot().chain.players), new Set([0,1,2]));
    assert.equal(g.events.filter(e => e.kind === 'trio_chain').length, 1);
    assert.equal(g.events.find(e => e.kind === 'trio_chain').data.bonus, 300);
    assert.equal(g.score, 300);
    g.registerClear(order[0]);
    assert.equal(g.events.filter(e => e.kind === 'trio_chain').length, 1);
  }
});

test('passing targets adjacent teammates in either direction and wraps for two or four players', () => {
  const g = game(3);
  g.players.forEach((p,i) => { p.cur = { kind:['R','G','B'][i], special:null }; });
  assert.equal(g.requestPass('1', -1), true);
  assert.deepEqual(g.events.find(e => e.kind === 'pass').data.players, [1,0]);
  assert.deepEqual(g.players.map(p => p.cur.kind), ['G','R','B']);
  assert.equal(g.requestPass('1', 1), false, 'shared cooldown prevents a second swap');
  g.passCd = 0;
  assert.equal(g.requestPass('2', 1), true);
  assert.deepEqual(g.events.filter(e => e.kind === 'pass')[1].data.players, [2,0]);
  assert.equal(game(2).requestPass('0', -1), true);
  const four = game(4);
  assert.equal(four.requestPass('0', -1), true);
  assert.deepEqual(four.events.find(e => e.kind === 'pass').data.players, [0,3]);
  assert.equal(four.passCd, PASS.cooldown);
  const live = game(3); live.setConnected('1', false);
  assert.equal(live.requestPass('0', 1), true, 'passing skips a disconnected seat');
  assert.deepEqual(live.events.find(e => e.kind === 'pass').data.players, [0,2]);
});

test('Team Power makes all active teammates rainbow and preserves the shared one-use meter', () => {
  const g = game(3); g.teamPowerCharge = TEAM_POWER.max;
  assert.equal(g.activateTeamPower('1'), true);
  assert.deepEqual(g.players.map(p => p.cur.special), ['rainbow','rainbow','rainbow']);
  assert.deepEqual(g.events.find(e => e.kind === 'team_power_activated').data.players, [0,1,2]);
  assert.equal(g.activateTeamPower('2'), false);
});

test('Shooting Star selectively gives trio a three-contributor lock with color-owned plates', () => {
  const duo = game(2, { level:34 }), trio = game(3, { level:34 }), four = game(4, { level:34 });
  assert.equal(duo.grid.get('1,4').special, 'star');
  assert.equal(trio.grid.get('1,4').special, 'triLock');
  assert.equal(four.grid.get('1,4').special, 'triLock');
  for (const i of [2,0,2,1]) trio.markTriLocks({ r:2, c:4, placedBy:i });
  assert.deepEqual(trio.grid.get('1,4').contributors, [2,0,1]);
  assert.equal(trio.grid.get('1,4').special, 'star');
  assert.equal(trio.events.filter(e => e.kind === 'tri_lock').length, 3);
  assert.equal(trio.score, 200);
  const client = fs.readFileSync(path.join(__dirname, '..', 'coop-bubbles.js'), 'utf8');
  assert.match(client, /b\.special === 'triLock'/);
  assert.match(client, /e\.kind==='tri_lock'/);
});
