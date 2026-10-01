'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OnlineGame, TEAM, teamPlay } = require('../server/game');
const { BattleGame } = require('../server/battle');
const { DEFAULT_SETTINGS } = require('../server/lobbies');

const root = path.resolve(__dirname, '..');
const duo = [{ id:'a', name:'Ada' }, { id:'b', name:'Ben' }];
const trio = [...duo, { id:'c', name:'Cy' }];

/* Build a board by hand. `cells` is [r, c, kind, placedBy, at]; a far-off anchored bubble
   keeps the level from clearing so resolveBatch never walks into the level card. */
const board = (roster = duo, settings = {}) => {
  const game = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:0, ...settings }, roster, 9);
  game.grid = new Map(); game.batch = []; game.events = [];
  game.put = (r, c, kind, placedBy = -1, at = 0) => { const b = { r, c, kind, special:null, placedBy, at }; game.grid.set(`${r},${c}`, b); return b; };
  game.put(0, 10, 'Y');
  // Land a shot for `shooter`, fired at `fired`, then resolve it.
  game.shoot = (shooter, r, c, kind, fired = 5) => {
    const b = game.put(r, c, kind, shooter, fired + 0.3); b.fired = fired;
    game.batch.push(b); game.now = fired + 0.3; game.resolveBatch();
  };
  game.teamEvents = () => game.events.filter(e => e.kind === 'team_play').map(e => e.data);
  return game;
};

test('P1 sets up, P2 clears: one team assist for P1 and the bonus for the team', () => {
  const game = board();
  game.put(0, 0, 'R', 0, 1); game.put(0, 1, 'R', 0, 2);
  const before = game.score;
  game.shoot(1, 0, 2, 'R');
  const [ev] = game.teamEvents();
  assert.deepEqual(ev.assists, [{ by:1, setup:[0] }]);
  assert.equal(ev.bonus, TEAM.assistBonus);
  assert.equal(game.players[0].stats.assists, 1, 'the setup player gets the assist');
  assert.equal(game.players[1].stats.assists, 0);
  assert.equal(game.score - before, game.popPoints(3) * 2 + TEAM.assistBonus, 'pop at the opened chain plus a flat bonus');
  const pop = game.events.find(e => e.kind === 'pop').data;
  assert.deepEqual(pop.shooters, [1], 'the pop names the resolving shooter');
  assert.deepEqual(pop.team.assists, [{ by:1, setup:[0] }], 'and carries the assist metadata');
});

test('P2 sets up, P1 clears: the rule is symmetric', () => {
  const game = board();
  game.put(0, 0, 'G', 1, 1); game.put(0, 1, 'G', 1, 1);
  game.shoot(0, 0, 2, 'G');
  assert.deepEqual(game.teamEvents()[0].assists, [{ by:0, setup:[1] }]);
  assert.equal(game.players[1].stats.assists, 1);
});

test('starting-board bubbles and your own bubbles are never a setup', () => {
  const start = board();
  start.put(0, 0, 'R'); start.put(0, 1, 'R');
  const before = start.score;
  start.shoot(1, 0, 2, 'R');
  assert.equal(start.teamEvents().length, 0);
  assert.equal(start.score - before, start.popPoints(3) * 2, 'no bonus on the authored board');
  assert.equal(start.players[0].stats.assists + start.players[1].stats.assists, 0);

  const own = board();
  own.put(0, 0, 'R', 1, 1); own.put(0, 1, 'R', 1, 2);
  own.shoot(1, 0, 2, 'R');
  assert.equal(own.teamEvents().length, 0, 'a same-player clear is not an assist');
});

test('a teammate bubble placed after the shot was fired is not a setup', () => {
  const game = board();
  game.put(0, 0, 'R', 0, 1); game.put(0, 1, 'R', 0, 5.1); // landed while P2's shot was in the air
  game.shoot(1, 0, 2, 'R', 5);
  assert.deepEqual(game.teamEvents()[0].assists, [{ by:1, setup:[0] }], 'the earlier bubble still counts');
  const late = board();
  late.put(0, 0, 'R', 0, 5.2); late.put(0, 1, 'R', 0, 5.2);
  late.shoot(1, 0, 2, 'R', 5);
  assert.equal(late.teamEvents().length, 0);
});

test('many teammate bubbles in one resolving shot earn one assist bonus, not one per bubble', () => {
  const game = board();
  for (let c = 0; c < 6; c++) game.put(0, c, 'B', 0, 1);
  game.shoot(1, 0, 6, 'B');
  const [ev] = game.teamEvents();
  assert.equal(ev.assists.length, 1);
  assert.equal(ev.bonus, TEAM.assistBonus);
  assert.equal(game.players[0].stats.assists, 1);
});

// A shot at (0,5) pops the two board Rs at (0,3),(0,4) and cuts a column the teammate hung.
const cutColumn = (game, owner, length) => {
  game.put(0, 3, 'R'); game.put(0, 4, 'R');
  for (let r = 1; r <= length; r++) game.put(r, 3, 'GBY'[r % 3], owner, 1);
};

test('cutting the support under a teammate\'s bubbles is an assist and a team drop', () => {
  const game = board();
  cutColumn(game, 0, 6);
  game.shoot(1, 0, 5, 'R');
  const [ev] = game.teamEvents();
  assert.deepEqual(ev.assists, [{ by:1, setup:[0] }], 'the drop alone qualifies the assist');
  assert.deepEqual(ev.drop, { by:1, setup:[0], n:6, huge:false });
  assert.equal(ev.bonus, TEAM.assistBonus + TEAM.dropBonus);
  assert.equal(game.events.find(e => e.kind === 'drop').data.team.drop.n, 6);

  const huge = board();
  cutColumn(huge, 0, 10);
  huge.shoot(1, 0, 5, 'R');
  assert.equal(huge.teamEvents()[0].drop.huge, true);
  assert.equal(huge.teamEvents()[0].bonus, TEAM.assistBonus + TEAM.hugeDropBonus);

  const small = board();
  cutColumn(small, 0, 4);
  small.shoot(1, 0, 5, 'R');
  assert.equal(small.teamEvents()[0].drop, null, 'below the threshold it is only an assist');
});

test('a set-up shot that clears the danger line is a team rescue', () => {
  const game = board();
  cutColumn(game, 0, 15);
  assert.ok(game.anyDangerCells(), 'the column reaches past the danger line');
  game.danger = { t:2, max:4 };
  const before = game.score;
  game.shoot(1, 0, 5, 'R');
  const [ev] = game.teamEvents();
  assert.deepEqual(ev.rescue, { by:1, setup:[0] });
  assert.equal(ev.bonus, TEAM.assistBonus + TEAM.rescueBonus + TEAM.hugeDropBonus);
  assert.equal(game.events.find(e => e.kind === 'rescue').data.team, true);
  assert.equal(game.players[1].stats.rescues, 1, 'the resolver gets the rescue');
  assert.equal(game.players[0].stats.assists, 1, 'the setup player gets the assist');
  assert.equal(game.danger, null);
  assert.ok(game.score - before > 500 + ev.bonus);

  // An unassisted rescue is still the ordinary +500 with no team callout.
  const plain = board();
  cutColumn(plain, -1, 15);
  plain.danger = { t:2, max:4 };
  plain.shoot(1, 0, 5, 'R');
  assert.equal(plain.teamEvents().length, 0);
  assert.equal(plain.events.find(e => e.kind === 'rescue').data.team, false);
});

test('alternating clears build the team chain and count as contributions', () => {
  const game = board();
  game.registerClear(0); assert.equal(game.chain.mult, 2);
  game.registerClear(1); assert.equal(game.chain.mult, 3);
  game.registerClear(0); assert.equal(game.chain.mult, 4);
  game.registerClear(1); assert.equal(game.chain.mult, 4, 'still capped');
  assert.equal(game.players[0].stats.chains, 2);
  assert.equal(game.players[1].stats.chains, 2);
  const chains = game.events.filter(e => e.kind === 'team_chain').map(e => e.data);
  assert.deepEqual(chains.map(c => c.handoff), [false, true, true, true], 'a handoff is announced');
  assert.deepEqual(chains[1], { by:1, from:0, mult:3, handoff:true, players:[0,1], trio:false });
  // Anti-spam is unchanged: one player hogging the field drops the chain.
  game.registerClear(1); game.registerClear(1); game.registerClear(1);
  assert.equal(game.chain.mult, 1);
});

test('the chain lapses on timeout and on a heavy miss meter, as before', () => {
  const game = board();
  game.registerClear(0); game.registerClear(1);
  assert.equal(game.chain.t, TEAM.chainSecs);
  for (let i = 0; i < Math.ceil(TEAM.chainSecs * 60) + 5; i++) game.update(1/60);
  assert.equal(game.chain.mult, 1, 'timed out');

  const miss = board();
  miss.registerClear(0); miss.registerClear(1);
  miss.missMeter = Math.ceil(miss.settings.missMax * 0.6);
  miss.shoot(0, 0, 0, 'G'); // a lone G: no match, a miss
  assert.equal(miss.chain.mult, 1, 'the miss reset it');
});

test('solo, endless and battle get no team events while trio does', () => {
  const solo = board([duo[0]]);
  solo.put(0, 0, 'R', 0, 1); solo.put(0, 1, 'R', 0, 1);
  solo.shoot(0, 0, 2, 'R');
  solo.registerClear(0);
  assert.equal(solo.events.filter(e => e.kind.startsWith('team_')).length, 0);
  assert.equal(solo.players[0].stats.chains, 0);

  const three = board(trio);
  three.put(0, 0, 'R', 0, 1); three.put(0, 1, 'R', 0, 1);
  const before = three.score;
  three.shoot(1, 0, 2, 'R');
  assert.equal(three.teamEvents().length, 1);
  assert.equal(three.score - before, three.popPoints(3) * 2 + TEAM.assistBonus, 'the trio gets ordinary setup credit');
  assert.equal(three.players[0].stats.assists, 1, 'the old owner assist stat is kept');

  const endless = board(duo, { mode:'endless' });
  endless.put(0, 0, 'R', 0, 1); endless.put(0, 1, 'R', 0, 1);
  endless.shoot(1, 0, 2, 'R');
  assert.equal(endless.teamEvents().length, 0);

  const battle = new BattleGame(DEFAULT_SETTINGS, duo, 4);
  for (const { game } of battle.boards || []) assert.deepEqual(game.teamHumans(), []);
  assert.deepEqual(new OnlineGame({ ...DEFAULT_SETTINGS, mode:'battle' }, duo, 1).teamHumans(), []);
});

test('the pure rules credit any cooperative roster and exclude bots', () => {
  const shots = [{ shooter:1, at:5, bubbles:[{ placedBy:0, at:1 }] }];
  assert.equal(teamPlay(TEAM, [0, 1], shots, [], false).bonus, TEAM.assistBonus);
  assert.equal(teamPlay(TEAM, [], shots, [], false).bonus, 0);
  assert.equal(teamPlay(TEAM, [0, 1, 2], shots, [], false).bonus, TEAM.assistBonus);
  // A bot teammate (not in the human list) neither gives nor receives credit locally.
  assert.equal(teamPlay(TEAM, [0, 2], shots, [], false).bonus, 0);
});

test('local play runs the same team rules as the server, verbatim', () => {
  const block = src => {
    const m = src.match(/\/\* team-rules:begin[\s\S]*?\/\* team-rules:end \*\//);
    assert.ok(m, 'team-rules block missing');
    return m[0];
  };
  const client = fs.readFileSync(path.join(root, 'coop-bubbles.js'), 'utf8');
  assert.equal(block(client), block(fs.readFileSync(path.join(root, 'server', 'game.js'), 'utf8')));
  // The client renders online bonuses from server events rather than deciding them.
  assert.match(client, /e\.kind==='team_play'\)\{this\.showTeamPlay\(d,/);
  assert.match(client, /e\.kind==='team_chain'/);
});
