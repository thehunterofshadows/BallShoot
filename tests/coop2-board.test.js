'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { LEVELS, GRID_PROFILES, rowsFit, levelLayout, levelColors, OnlineGame } = require('../server/game');
const { DEFAULT_SETTINGS } = require('../server/lobbies');

const component = fs.readFileSync(path.resolve(__dirname, '..', 'coop-bubbles.js'), 'utf8');
const loadComponent = () => {
  let Cls;
  const ctx = { CoopObjects: require('../coop-objects'), HTMLElement: class {}, customElements: { get: () => null, define: (n, c) => { Cls = c; } },
    document: { addEventListener() {}, removeEventListener() {} }, Image: class {}, navigator: {}, performance: { now: () => 0 }, console,
    location: {}, localStorage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, clearTimeout() {}, cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), devicePixelRatio: 1,
    getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0', getPropertyValue: () => '' }) };
  ctx.window = ctx;
  vm.runInNewContext(component, ctx);
  return Cls;
};
const C = loadComponent();
/* A local game, reset with real rules; only the DOM-facing calls are stubbed. */
const local = (settings = {}) => {
  const g = Object.assign(Object.create(C.prototype), {
    online: false, state: 'play', H: 1080, LAUNCH_Y: 938, DANGER_Y: 846,
    settings: { players: 2, human: [true, true, false, false], mode: 'clear', field: 'classic', level: 0, reload: 0,
      missMax: 8, pressureShots: 8, hurry: 0, assist: 0.35, mateLines: true, sound: false, ...settings },
    hideOverlays() {}, showObjectGuide() {}, sfx() {}, callout() {},
  });
  g.resetGame();
  return g;
};
const twoP = LEVELS.map(L => L.layouts && L.layouts.coop2).filter(Boolean);
const supported = rows => {
  const has = (r, c) => r >= 0 && r < rows.length && c >= 0 && c < rows[r].length && rows[r][c] !== '.';
  const nb = (r, c) => { const p = r & 1, a = c - 1 + p, b = c + p; return [[r, c - 1], [r, c + 1], [r - 1, a], [r - 1, b], [r + 1, a], [r + 1, b]]; };
  const seen = new Set(), st = [];
  [...rows[0]].forEach((ch, c) => { if (ch !== '.') { seen.add('0,' + c); st.push([0, c]); } });
  while (st.length) { const [r, c] = st.pop(); for (const [nr, nc] of nb(r, c)) if (has(nr, nc) && !seen.has(nr + ',' + nc)) { seen.add(nr + ',' + nc); st.push([nr, nc]); } }
  return rows.every((row, r) => [...row].every((ch, c) => ch === '.' || seen.has(r + ',' + c)));
};
// A hand-built board on a local game: cleared, then filled cell by cell.
const board = (g, cells) => {
  g.grid = new Map(); g.objects = [];
  for (const [r, c, kind, placedBy = -1] of cells) g.grid.set(`${r},${c}`, { r, c, kind, special: null, contributors: [], placedBy, at: 0 });
  g.updateLowest();
};
const shoot = (g, r, c, kind, by) => {
  const b = { r, c, kind, special: null, contributors: [], placedBy: by, at: g.now, fired: g.now };
  g.grid.set(`${r},${c}`, b); g.batch.push(b); g.resolveBatch();
};

test('grid profiles: classic stays 11/10 and coop2 is one continuous 16/15 field', () => {
  assert.deepEqual({ ...GRID_PROFILES.classic, fallbackDropScale: undefined }, { evenColumns: 11, oddColumns: 10, staggered: true, fallbackDropScale: undefined });
  assert.equal(GRID_PROFILES.coop2.evenColumns, 16);
  assert.equal(GRID_PROFILES.coop2.oddColumns, 15);
  for (const L of LEVELS) assert.ok(rowsFit(L.rows, GRID_PROFILES.classic), `${L.name} classic rows still 11/10`);
});

test('twelve purpose-built coop2 rounds validate against 16/15 and use the width without doubling the wall', () => {
  assert.equal(twoP.length, 12);
  assert.equal(new Set(twoP.map(v => v.name)).size, 12, 'each 2P round has its own name');
  for (const n of ['Open Hands', 'Twin Towers', 'Center Cut', 'Crossfire', 'The Bridge', 'Bank Exchange', 'Two Keys',
    'Domino Drop', 'Hanging Garden', 'Crossed Supports', 'Shared Rescue', 'Grand Canopy']) assert.ok(twoP.some(v => v.name === n), n);
  let colours = 0;
  twoP.forEach((v, i) => {
    assert.ok(rowsFit(v.rows, GRID_PROFILES.coop2), `${v.name}: rows alternate 16/15`);
    assert.ok(v.rows.length <= 12, `${v.name}: at most 12 rows`);
    assert.ok(supported(v.rows), `${v.name}: every bubble hangs from the ceiling`);
    const cells = v.rows.join('').replace(/\./g, '').length, area = v.rows.join('').length;
    assert.ok(cells / area <= 0.65, `${v.name}: keeps open space (${cells}/${area})`);
    // Something on both sides of the centre line: one shared puzzle, not half a board.
    const sides = v.rows.flatMap((row, r) => [...row].map((ch, c) => ch === '.' ? null : c + (r & 1) * 0.5 < 7.5)).filter(x => x !== null);
    assert.ok(sides.includes(true) && sides.includes(false), `${v.name}: spans both halves`);
    const k = levelColors(v.rows);
    assert.ok(k >= colours, `${v.name}: colour count never falls (${k})`); colours = k;
    assert.ok(Number.isInteger(v.drop) && v.drop > LEVELS[i].drop, `${v.name}: paced slower than its classic round for two shooters`);
  });
  assert.equal(levelColors(twoP[0].rows), 3);
  assert.equal(levelColors(twoP[11].rows), 6);
});

test('rounds without a coop2 layout centre their classic rows on whole columns', () => {
  const L = LEVELS[20], v = levelLayout(L, 'coop2');
  assert.equal(L.layouts, undefined);
  assert.equal(v.rows, L.rows);
  assert.equal(v.off, 2);
  assert.equal(v.drop, Math.round(L.drop * GRID_PROFILES.coop2.fallbackDropScale));
  const c = levelLayout(L, 'classic');
  assert.deepEqual([c.off, c.drop, c.rows], [0, L.drop, L.rows], 'classic is untouched');
  assert.equal(levelLayout(LEVELS[0], 'classic').rows, LEVELS[0].rows, 'solo / Battle never inherit a coop2 variant');
});

test('local 2P Co-op Clear loads the 16/15 board with launchers at the quarter points', () => {
  const g = local();
  assert.equal(g.profile, 'coop2');
  assert.equal(g.cols, 16);
  assert.deepEqual([g.colsIn(0), g.colsIn(1)], [16, 15]);
  assert.equal(g.WW, 12 * 2 + 56 * 16);
  assert.equal(g.VW, g.WW, 'the view is the whole field');
  assert.deepEqual(Array.from(g.players, p => p.x), [g.WW / 4, g.WW * 3 / 4]);
  const rows = LEVELS[0].layouts.coop2.rows;
  assert.equal(g.grid.size, rows.join('').replace(/\./g, '').length);
  assert.ok(g.grid.has('0,15') && g.grid.has('1,14'), 'the far right cells are real cells');
  assert.equal(g.levelDrop(), LEVELS[0].layouts.coop2.drop);
  assert.equal(g.roundName(0), 'Open Hands');
  // Every cell sits inside the walls, with bubbles the classic size and spacing.
  for (const b of g.grid.values()) {
    const x = g.cellX(b.r, b.c);
    assert.ok(x >= 12 + 28 - 1e-9 && x <= g.WW - 12 - 28 + 1e-9);
  }
  assert.equal(g.cellX(0, 1) - g.cellX(0, 0), 56);
});

test('solo, trio, four-player, wide, Battle and online keep the classic board', () => {
  for (const s of [{ players: 1 }, { players: 3 }, { players: 4 }, { mode: 'endless' }]) {
    const g = local(s);
    assert.equal(g.profile, 'classic', JSON.stringify(s));
    assert.deepEqual([g.cols, g.WW, g.VW], [11, 640, 640]);
  }
  const wide = local({ field: 'wide' });
  assert.deepEqual([wide.profile, wide.WW, wide.VW], ['classic', 2560, 640]);
  const g = local();
  g.online = true;
  assert.deepEqual([g.profile, g.VW], ['classic', 640], 'a room never inherits the local board');
  assert.equal(g.roundName(0), LEVELS[0].name);
  g.online = false; g.battle = { boards: [] };
  assert.deepEqual([g.profile, g.VW], ['classic', 640]);
  // The server is unchanged: rooms are 11 columns.
  const room = new OnlineGame({ ...DEFAULT_SETTINGS, mode: 'clear' }, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 9);
  assert.deepEqual([room.cols, room.WW], [11, 640]);
});

test('custom rounds centre on the 2P board', () => {
  const g = Object.assign(Object.create(C.prototype), { customText: 'RRGGBBYYRRG\nR...BB...G', settings: { level: 'custom' }, profileKey: 'coop2' });
  const v = g.levelLayout();
  assert.deepEqual([v.off, v.drop, v.rows.length], [2, 0, 2]);
  g.customText = '....';
  assert.equal(g.levelLayout().name, LEVELS[0].layouts.coop2.name, 'an empty custom board falls back to round 1');
});

test('matches and floating drops work across the centre with no seam', () => {
  const g = local();
  // A red run across columns 6..9 of row 0, set up by P1 on the right of centre.
  board(g, [[0, 0, 'G'], [0, 6, 'R', 0], [0, 7, 'R', 0], [0, 8, 'B']]);
  shoot(g, 0, 9, 'B', 1);
  assert.equal(g.grid.has('0,8'), true, 'two blues do not pop');
  shoot(g, 1, 8, 'B', 1);
  assert.equal(['0,8', '0,9', '1,8'].some(k => g.grid.has(k)), false, 'a group straddling the centre pops');
  // A pendant hung from the centre falls when its stem goes, whichever side it hangs on.
  board(g, [[0, 0, 'G'], [0, 7, 'Y'], [0, 8, 'Y'], [1, 7, 'B'], [2, 8, 'B'], [2, 9, 'R'], [3, 9, 'R'], [4, 10, 'G']]);
  shoot(g, 1, 8, 'Y', 0);
  assert.equal(g.grid.has('0,7'), false);
  for (const k of ['1,7', '2,8', '2,9', '3,9', '4,10']) assert.equal(g.grid.has(k), false, `${k} dropped`);
  assert.equal(g.grid.has('0,0'), true, 'the far anchor stays');
});

test('Team Assist ownership survives across the board', () => {
  const g = local();
  // P1 places two reds on the far right; P2, firing from the left, finishes them.
  board(g, [[0, 0, 'G'], [0, 13, 'R', 0], [0, 14, 'R', 0]]);
  g.now = 1;
  shoot(g, 0, 15, 'R', 1);
  assert.equal(g.grid.has('0,14'), false);
  assert.equal(g.players[1].stats.assists + g.players[0].stats.assists >= 1, true, 'the cross-board finish is a team assist');
});

test('either launcher reaches the far side directly and with a bank shot', () => {
  const g = local();
  board(g, [[0, 0, 'G'], [0, 15, 'B']]);
  const [p1, p2] = g.players;
  // P1 (left) into the far right ceiling, straight.
  const right = g.simulate(p1.x, Math.atan2(g.cellX(0, 14) - p1.x, (g.LAUNCH_Y - 44) - g.cellY(0)));
  assert.ok(right.cell && right.cell.c >= 12, `P1 reaches column ${right.cell && right.cell.c}`);
  assert.equal(right.bounces, 0);
  // P2 (right) into the far left, straight.
  const left = g.simulate(p2.x, -Math.atan2(p2.x - g.cellX(0, 2), (g.LAUNCH_Y - 44) - g.cellY(0)));
  assert.ok(left.cell && left.cell.c <= 3, `P2 reaches column ${left.cell && left.cell.c}`);
  // A cross-board bank: P1 off the right wall into the right half.
  let banked = null;
  for (let a = 0.6; a < 1.22 && !banked; a += 0.01) { const s = g.simulate(p1.x, a); if (s.bounces === 1 && s.cell) banked = s; }
  assert.ok(banked, 'a right-wall bank lands');
  assert.ok(banked.bpts[0].x > g.WW - 60, 'it banks off the far wall');
  // And a real flight resolves into the field where the trace said.
  g.state = 'play'; p1.reload = 0; p1.cur = { kind: 'R', special: null }; p1.angle = Math.atan2(g.cellX(0, 13) - p1.x, (g.LAUNCH_Y - 44) - g.cellY(0));
  g.fire(0);
  for (let i = 0; i < 400 && g.flights.length; i++) g.stepFlights(1 / 120);
  const placed = [...g.grid.values()].find(b => b.placedBy === 0);
  assert.ok(placed && placed.c >= 11, `P1's shot settled at column ${placed && placed.c}`);
});

test('the 2P camera is fixed: aim, shots, pops and drops never move it', () => {
  const g = local();
  g.camX = 0;
  const step = () => g.update(1 / 120);
  for (const p of g.players) p.angle = 1.1;
  g.activeP = 1;
  for (let i = 0; i < 60; i++) step();
  assert.equal(g.camX, 0);
  g.players[0].angle = -1.1; g.activeP = 0;
  g.fire(0);
  for (let i = 0; i < 60; i++) step();
  assert.equal(g.camX, 0, 'camera holds through aim and a shot in flight');
  // The camera code only runs when the field is wider than the view.
  const wide = local({ field: 'wide' });
  assert.ok(wide.WW > wide.VW);
  assert.match(component, /if \(this\.WW > this\.VW\) \{/);
});

test('the board fits uniformly in every display shape and re-fits only for display changes', () => {
  const g = local(), aspect = g.VW / g.H;
  for (const [w, h] of [[1920, 1080], [3840, 2160], [1920, 1200], [2560, 1080], [1280, 900], [1024, 1366]]) {
    const boardW = Math.min(w, h * aspect), boardH = boardW / aspect;
    assert.ok(boardW <= w + 1e-9 && boardH <= h + 1e-9, `${w}x${h}: the whole board is visible`);
    assert.ok(Math.abs(boardW / boardH - aspect) < 1e-9, `${w}x${h}: never stretched`);
  }
  // The DOM layout and canvas use the view width for both axes' scale.
  assert.match(component, /el\.height = Math\.round\(w \* dpr \* this\.H \/ this\.VW\)/);
  assert.match(component, /const sc = this\.canvas\.width \/ this\.VW;/);
  assert.match(component, /tvLayout\(key, this\.VW \/ this\.H, n, TV, fit\)/);
  // A width change re-measures once; nothing in play does.
  assert.match(component, /if \(this\._laidVW !== this\.VW && this\.rootEl\) this\.measure\(\);/);
});
