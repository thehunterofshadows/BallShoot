'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OnlineGame, LEVELS, LEVEL_KINDS, PACE, clearTimeBonus, dropPace } = require('../server/game');
const { DEFAULT_SETTINGS } = require('../server/lobbies');
const lobbies = require('../server/lobbies');

const root = path.resolve(__dirname, '..');
const duo = [{ id:'a', name:'Ada' }, { id:'b', name:'Ben' }];
const block = (file, name) => {
  const m = fs.readFileSync(path.join(root, file), 'utf8').match(new RegExp(`/\\* ${name}:begin[\\s\\S]*?/\\* ${name}:end \\*/`));
  assert.ok(m, `${file} has a ${name} block`);
  return m[0];
};
// Round tiers from the issue: colour count, ceiling pace and depth climb together.
const TIERS = [
  { from: 0, to: 9, colors: 3, drop: 10, rows: [3, 5] },
  { from: 10, to: 21, colors: 4, drop: 9, rows: [4, 7] },
  { from: 22, to: 33, colors: 5, drop: 8, rows: [5, 8] },
  { from: 34, to: 45, colors: 6, drop: 7, rows: [6, 9] },
  { from: 46, to: 51, colors: 6, drop: 6, rows: [8, 11] },
];
const tierOf = i => TIERS.find(t => i >= t.from && i <= t.to);
const cells = L => L.rows.reduce((n, row) => n + row.replace(/\./g, '').length, 0);

// A hand-built Co-op Clear board, as in coop-team.test.js. A far bubble keeps it from clearing.
const board = (settings = {}) => {
  const game = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:0, hurry:0, ...settings }, duo, 9);
  game.grid = new Map(); game.batch = []; game.events = [];
  game.put = (r, c, ch, placedBy = -1) => {
    const special = { '#':'stone', '*':'star', '+':'rainbow' }[ch] || null;
    const b = { r, c, kind: ch, special, placedBy, at: 0 }; game.grid.set(`${r},${c}`, b); return b;
  };
  game.put(0, 10, 'Y');
  game.shoot = (r, c, kind, special = null) => {
    const b = game.put(r, c, kind, 0); b.special = special; b.fired = 1;
    game.batch.push(b); game.resolveBatch();
  };
  game.eventsOf = kind => game.events.filter(e => e.kind === kind).map(e => e.data);
  return game;
};
const has = (game, r, c) => game.grid.has(`${r},${c}`);

test('the level library and the pace rules are mirrored verbatim in client and server', () => {
  for (const name of ['levels', 'pace-rules'])
    assert.equal(block('coop-bubbles.js', name), block('server/game.js', name), `${name} must match`);
  // One source of truth: the server no longer keeps its own row arrays next to the block.
  const server = fs.readFileSync(path.join(root, 'server', 'game.js'), 'utf8');
  assert.equal(server.match(/const LEVELS = \[/g).length, 1);
});

test('there are 50+ named rounds in five tiers', () => {
  assert.ok(LEVELS.length >= 50, `${LEVELS.length} rounds`);
  assert.equal(new Set(LEVELS.map(L => L.name)).size, LEVELS.length, 'every round has its own name');
  for (const name of ['The Vault', 'Chandeliers', 'The Canyon', 'Hive Bridge'])
    assert.ok(LEVELS.findIndex(L => L.name === name) >= 46, `${name} is a late set-piece`);
  LEVELS.forEach((L, i) => assert.ok(tierOf(i), `round ${i + 1} belongs to a tier`));
});

test('every round has alternating 11/10 rows, at most 12, and only valid cells', () => {
  LEVELS.forEach((L, i) => {
    assert.ok(L.rows.length >= 1 && L.rows.length <= 12, `${L.name}: row count`);
    const [lo, hi] = tierOf(i).rows;
    assert.ok(L.rows.length >= lo && L.rows.length <= hi, `${L.name}: ${L.rows.length} rows for its tier`);
    L.rows.forEach((row, r) => {
      assert.equal(row.length, r % 2 ? 10 : 11, `${L.name} row ${r} width`);
      assert.match(row, /^[RYGBPO#*+.]+$/, `${L.name} row ${r} characters`);
    });
    assert.equal(L.drop, tierOf(i).drop, `${L.name}: ceiling pace for its tier`);
  });
});

test('every bubble hangs from the ceiling, so nothing is silently purged', () => {
  LEVELS.forEach((L, i) => {
    const game = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:i }, duo, 1);
    assert.equal(game.grid.size, cells(L), `${L.name}: every authored cell is on the board`);
  });
});

test('stones never sit on the ceiling, so every stone falls once the rest is gone', () => {
  LEVELS.forEach((L, i) => {
    assert.doesNotMatch(L.rows[0], /#/, `${L.name}: no stone in row 0`);
    const game = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:i }, duo, 1);
    const stones = [...game.grid.values()].filter(b => b.special === 'stone').length;
    for (const [k, b] of [...game.grid]) if (b.special !== 'stone') game.grid.delete(k);
    assert.equal(game.removeFloaters().length, stones, `${L.name}: all ${stones} stones drop`);
    assert.equal(game.grid.size, 0, `${L.name}: the round can be cleared`);
  });
});

test('each round uses exactly its tier\'s colour count, and specials arrive with tier 3', () => {
  LEVELS.forEach((L, i) => {
    const used = new Set(L.rows.join('').split('').filter(ch => LEVEL_KINDS.includes(ch)));
    assert.equal(used.size, tierOf(i).colors, `${L.name}: ${[...used].join('')}`);
    if (i < 22) assert.doesNotMatch(L.rows.join(''), /[#*+]/, `${L.name}: no specials this early`);
    if (tierOf(i).colors === 5) assert.ok(!used.has('O'), `${L.name}: orange arrives in tier 4`);
  });
  assert.ok(LEVELS.slice(22, 34).every(L => L.rows.join('').includes('#')), 'tier 3 teaches stones');
  assert.ok(LEVELS.slice(34, 46).every(L => /[*+]/.test(L.rows.join(''))), 'tier 4 teaches stars and rainbows');
});

test('a stone never pops, even in a bomb blast, and falls with what it hangs from', () => {
  const game = board();
  game.put(0, 0, 'R'); game.put(0, 1, 'R'); game.put(1, 0, '#');
  game.shoot(0, 2, 'R');
  const drop = game.eventsOf('drop')[0], pop = game.eventsOf('pop')[0];
  assert.equal(pop.bubbles.length, 3, 'only the three reds pop');
  assert.ok(drop && drop.bubbles.some(b => b.special === 'stone'), 'the stone fell');
  assert.equal(has(game, 1, 0), false);

  const blast = board();
  blast.put(0, 3, 'G'); blast.put(0, 4, 'B'); blast.put(1, 3, '#');
  blast.shoot(0, 5, 'R', 'bomb');
  assert.ok(!blast.eventsOf('pop')[0].bubbles.some(b => b.special === 'stone'), 'the blast spared the stone');
  assert.ok(blast.eventsOf('drop')[0].bubbles.some(b => b.special === 'stone'), 'it fell instead');
});

test('a shot beside a star clears every bubble of its colour', () => {
  const game = board();
  game.put(0, 0, '*'); game.put(0, 4, 'B'); game.put(0, 5, 'G'); game.put(0, 7, 'B');
  game.shoot(0, 1, 'B');
  assert.equal(has(game, 0, 0), false, 'the star went');
  assert.equal(has(game, 0, 4) || has(game, 0, 7) || has(game, 0, 1), false, 'every blue went');
  assert.equal(has(game, 0, 5), true, 'other colours stay');
  assert.equal(game.eventsOf('pop')[0].bubbles.length, 4);
});

test('a grid rainbow joins a colour group but never bridges two colours', () => {
  const game = board();
  game.put(0, 0, 'R'); game.put(0, 1, '+');
  game.shoot(0, 2, 'R');
  assert.equal(game.eventsOf('pop')[0].bubbles.length, 3, 'R + rainbow + R pops');

  const two = board();
  two.put(0, 0, 'R'); two.put(0, 1, '+'); two.put(0, 2, 'G');
  two.shoot(0, 3, 'G');
  assert.equal(has(two, 0, 0), true, 'the red on the far side of the rainbow stays');
});

test('the ceiling pace comes from the round, scaled by Shot pressure, with a custom fallback', () => {
  const first = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:0 }, duo, 1);
  assert.equal(first.shotsPerDrop(), LEVELS[0].drop, 'the default pressure plays a round as authored');
  first.settings.pressureShots = PACE.basePressure * 2;
  assert.equal(first.shotsPerDrop(), LEVELS[0].drop * 2);
  first.settings.pressureShots = 0;
  assert.equal(first.shotsPerDrop(), 0, 'zero still turns it off');
  const last = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:LEVELS.length - 1 }, duo, 1);
  assert.equal(last.shotsPerDrop(), LEVELS[LEVELS.length - 1].drop);
  const custom = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:'custom', customText:'RRYYBB', pressureShots:11 }, duo, 1);
  assert.equal(custom.shotsPerDrop(), 11, 'a custom board runs on the setting');
  // The countdown tightens from the round's own colour count, never below three.
  assert.equal(dropPace(10, 8, 3, 1), 8);
  assert.equal(dropPace(4, 8, 6, 1), 3);
});

test('a fast clear pays the full time bonus, sliding to nothing at two minutes', () => {
  assert.equal(clearTimeBonus(0), PACE.timeBonus);
  assert.equal(clearTimeBonus(PACE.timeFull), PACE.timeBonus);
  assert.equal(clearTimeBonus((PACE.timeFull + PACE.timeZero) / 2), PACE.timeBonus / 2);
  assert.equal(clearTimeBonus(PACE.timeZero), 0);
  assert.equal(clearTimeBonus(600), 0);

  const quick = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:0 }, duo, 1);
  quick.now = quick.levelStartT + 10;
  quick.grid = new Map(); quick.batch = []; quick.resolveBatch();
  assert.equal(quick.state, 'levelup');
  assert.equal(quick.levelSummary.timeBonus, PACE.timeBonus);
  assert.equal(quick.levelSummary.secs, 10);
  assert.equal(quick.score, quick.levelSummary.bonus + PACE.timeBonus, 'both bonuses are banked');
  assert.equal(quick.events.find(e => e.kind === 'level_cleared').data.timeBonus, PACE.timeBonus);

  const slow = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:0 }, duo, 1);
  slow.now = slow.levelStartT + 200;
  slow.grid = new Map(); slow.batch = []; slow.resolveBatch();
  assert.equal(slow.levelSummary.timeBonus, 0);
  // The clock restarts with the next round.
  quick.levelReady('a'); quick.levelReady('b');
  assert.equal(quick.levelStartT, quick.now);
});

test('hurry-up warns, then fires an idle launcher at its current angle', () => {
  const game = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:0, hurry:8 }, duo, 3);
  const angle = game.players[1].angle;
  const run = secs => { for (let t = 0; t < secs * 60; t++) game.update(1 / 60); };
  run(3.1);
  assert.deepEqual(game.events.filter(e => e.kind === 'hurry').map(e => e.data.player).sort(), [0, 1], 'HURRY UP! with 5s left');
  game.input('a', { l:true }); run(0.1); game.input('a', {});
  run(5);
  const autos = game.events.filter(e => e.kind === 'launch' && e.data.auto).map(e => e.data);
  assert.deepEqual(autos.map(d => d.player), [1], 'only the idle player auto-fired');
  assert.equal(autos[0].angle, angle, 'at the angle they were holding');
  assert.equal(game.players[1].stats.shots, 1);
  assert.ok(game.players[1].idle < 1, 'firing resets the clock');
});

test('hurry-up is off at 0, on battle boards and while a Team Power holds the clocks', () => {
  const run = (game, secs) => { for (let t = 0; t < secs * 60; t++) game.update(1 / 60); return game; };
  const off = run(new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:0, hurry:0 }, duo, 3), 12);
  assert.equal(off.events.filter(e => e.kind === 'launch').length, 0);
  const battle = run(new OnlineGame({ ...DEFAULT_SETTINGS, mode:'battle', hurry:8 }, [duo[0]], 3), 12);
  assert.equal(battle.events.filter(e => e.kind === 'launch').length, 0);
  const held = new OnlineGame({ ...DEFAULT_SETTINGS, mode:'clear', level:0, hurry:8 }, duo, 3);
  held.teamPowerCharge = 100; held.activateTeamPower('a');
  run(held, 7);
  assert.equal(held.players[0].idle || 0, 0, 'the idle clock does not run during the burst');
});

test('room settings accept every round and the hurry setting, and nothing past the end', () => {
  const room = lobbies.create('Host', null, 'levels-test').room, host = room.players[0];
  lobbies.updateSettings(room, host, { ...room.settings, level: LEVELS.length - 1, hurry: 12 }, room.revision);
  assert.equal(room.settings.level, LEVELS.length - 1);
  assert.equal(room.settings.hurry, 12);
  assert.throws(() => lobbies.updateSettings(room, host, { ...room.settings, level: LEVELS.length }, room.revision), /level/i);
  assert.throws(() => lobbies.updateSettings(room, host, { ...room.settings, hurry: -1 }, room.revision), /hurry/i);
  lobbies.clear();
});

test('the client builds both level pickers from LEVELS and draws six colours', () => {
  const client = fs.readFileSync(path.join(root, 'coop-bubbles.js'), 'utf8');
  assert.doesNotMatch(client, /<option value="0">1\. The Vault<\/option>/, 'no hardcoded level list');
  assert.equal(client.match(/\$\{levelOptionsHTML\(\)\}/g).length, 2, 'side panel and lobby share the generated list');
  for (const kind of LEVEL_KINDS) assert.match(client, new RegExp(`PAL {2}= \\{[^}]*\\b${kind}:'#`), `palette has ${kind}`);
  // The test container does not mount assets/, so this checks the wiring, not the files.
  for (const file of ['purple.webp', 'orange.webp']) assert.match(client, new RegExp(`assets/bubbles/${file}`));
});
