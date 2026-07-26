'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OnlineGame, geom, normalizeViewH } = require('../server/game');
const { DEFAULT_SETTINGS } = require('../server/lobbies');
const fs = require('node:fs');
const path = require('node:path');

const roster = [{id:'a',name:'Ada'},{id:'b',name:'Ben'}];

test('the default world height reproduces the original fixed geometry exactly', () => {
  // This is the guard that making the field height adaptive changed no gameplay at the
  // size the game shipped with.
  assert.deepEqual(geom(1080), { H:1080, LAUNCH_Y:938, DANGER_Y:846 });
});

test('world height is quantised and clamped so odd screens cannot warp the field', () => {
  assert.equal(geom(1087).H, 1080);          // snaps to the nearest 20 units
  assert.equal(geom(1091).H, 1100);
  // A wide screen clamps to the original height and letterboxes rather than shrinking the
  // world, so no shape gets less runway than the game already shipped with.
  assert.equal(geom(400).H, 1080);
  assert.equal(geom(9000).H, 1560);          // a very tall screen clamps to the maximum
  assert.equal(geom(undefined).H, 1080);     // an absent setting falls back to the default
  assert.equal(geom('nonsense').H, 1080);
  // The launcher and danger line keep their historic distance from the floor.
  const g = geom(1400);
  assert.equal(g.H - g.LAUNCH_Y, 142);
  assert.equal(g.LAUNCH_Y - g.DANGER_Y, 92);
});

test('the client mirrors the server world-height derivation bit for bit', () => {
  // Client and server run the same sim; a divergent geom() would desync every online room.
  const client = fs.readFileSync(path.join(__dirname, '..', 'coop-bubbles.js'), 'utf8');
  const shape = /const H0 = 1080, VIEWH_MIN = H0, VIEWH_MAX = 1560, LAUNCH_GAP = 142, DANGER_GAP = 92;/;
  assert.match(client, shape);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server', 'game.js'), 'utf8'), shape);
  assert.match(client, /clamp\(Math\.round\(vh \/ 20\) \* 20, VIEWH_MIN, VIEWH_MAX\)/);
});

test('a room adopts the host world height and the sim honours it', () => {
  const game = new OnlineGame({...DEFAULT_SETTINGS, viewH:1500}, roster, 7);
  assert.equal(game.H, 1500);
  assert.equal(game.LAUNCH_Y, 1358);
  assert.equal(game.DANGER_Y, 1266);
  assert.equal(game.snapshot().settings.viewH, 1500);
  // A hostile or broken client cannot hand the room an out-of-range world.
  assert.equal(normalizeViewH(99999), 1560);
  assert.equal(normalizeViewH(-1), 1080);
});

test('a taller world gives more runway before the danger line', () => {
  const rowsBefore = g => Math.floor((g.DANGER_Y - g.gridTop) / (28 * Math.sqrt(3)));
  const short = new OnlineGame({...DEFAULT_SETTINGS, viewH:1080}, roster, 7);
  const tall = new OnlineGame({...DEFAULT_SETTINGS, viewH:1560}, roster, 7);
  assert.ok(rowsBefore(tall) > rowsBefore(short));
});

test('seeded games produce identical authoritative state', () => {
  const a=new OnlineGame(DEFAULT_SETTINGS,roster,12345), b=new OnlineGame(DEFAULT_SETTINGS,roster,12345);
  a.input('a',{r:true});b.input('a',{r:true});
  for(let i=0;i<30;i++){a.update(1/60);b.update(1/60);}
  a.fire('a');b.fire('a');
  for(let i=0;i<180;i++){a.update(1/60);b.update(1/60);}
  assert.deepEqual(a.snapshot(),b.snapshot());
});

test('wide fields and settings are represented in snapshots', () => {
  const game=new OnlineGame({...DEFAULT_SETTINGS,field:'wide',guide:.25,sound:false},roster,7);
  const snapshot=game.snapshot();
  assert.equal(snapshot.WW,2560);
  assert.equal(snapshot.players.length,2);
  assert.equal(snapshot.settings.guide,.25);
  assert.equal(snapshot.settings.sound,false);
  assert.ok(snapshot.grid.length>40);
});

const ROWH = 28 * Math.sqrt(3);
// Fire `n` shots straight at the ceiling, letting each one fully resolve.
const shoot = (game, n) => { for (let i=0;i<n;i++){ game.fire('a'); for(let t=0;t<180;t++) game.update(1/60); } };

test('the field descends one row every pressureShots shots', () => {
  const game=new OnlineGame({...DEFAULT_SETTINGS,pressureShots:8,missMax:20},roster,4242);
  const before={parity:game.parityFlip,anchor:game.anchorRow,top:game.cellY(game.anchorRow)};
  shoot(game,8);
  assert.equal(game.anchorRow,before.anchor+1,'anchor row advanced exactly once');
  assert.equal(game.parityFlip,before.parity^1,'wall stagger alternated');
  assert.equal(game.pressure,0,'counter reset');
  for(let t=0;t<120;t++)game.update(1/60); // let the gridTop easing settle
  assert.ok(Math.abs(game.cellY(game.anchorRow)-(before.top+ROWH))<0.001,'ceiling row sits exactly one ROWH lower');
});

test('a descent never orphans the board', () => {
  const game=new OnlineGame({...DEFAULT_SETTINGS,pressureShots:8,missMax:20},roster,99);
  const positions=new Map();
  game.grid.forEach((b,k)=>positions.set(k,game.cellX(b.r,b.c)));
  const size=game.grid.size;
  game.pressure=99;game.update(1/60);
  assert.equal(game.anchorRow,1);
  assert.equal(game.removeFloaters().length,0,'nothing detached once row 0 emptied');
  assert.equal(game.grid.size,size,'every bubble survived');
  game.grid.forEach(b=>{
    assert.ok(Math.abs(game.cellX(b.r,b.c)-positions.get(`${b.r-1},${b.c}`))<0.001,'no sideways drift');
  });
});

test('fewer colours on the board means faster drops', () => {
  const game=new OnlineGame({...DEFAULT_SETTINGS,pressureShots:8},roster,5);
  assert.equal(game.shotsPerDrop(),8);
  for(const [k,b] of [...game.grid]) if(b.kind!=='R'&&b.kind!=='G') game.grid.delete(k);
  assert.equal(game.shotsPerDrop(),6,'two colours left costs two shots');
  game.settings.pressureShots=0;
  assert.equal(game.shotsPerDrop(),0,'zero disables the mechanic');
});

test('swap exchanges the queue without consuming a shot or beating the reload', () => {
  const game=new OnlineGame(DEFAULT_SETTINGS,roster,777), p=game.players[0];
  const cur={...p.cur}, next={...p.next};
  assert.equal(game.swap('a'),true);
  assert.deepEqual({kind:p.cur.kind,special:p.cur.special},{kind:next.kind,special:next.special});
  assert.deepEqual({kind:p.next.kind,special:p.next.special},{kind:cur.kind,special:cur.special});
  assert.equal(p.stats.shots,0,'a swap is not a shot');
  assert.equal(game.pressure,0,'a swap does not push the ceiling');
  // Firing starts the cooldown, and the cooldown must gate swapping too — otherwise it
  // becomes a free re-roll of the bubble you just decided not to like.
  game.fire('a');
  assert.ok(p.reload>0);
  assert.equal(game.swap('a'),false);
  for(let t=0;t<180;t++)game.update(1/60);
  assert.equal(game.swap('a'),true);
  game.setConnected('a',false);
  assert.equal(game.swap('a'),false,'a disconnected launcher cannot swap');
});

test('clear mode chains the authored levels and carries the score', () => {
  const game=new OnlineGame({...DEFAULT_SETTINGS,mode:'clear',level:0},[roster[0]],31);
  game.players[0].stats.shots=10;game.players[0].stats.pops=5;
  game.grid=new Map();game.batch=[];game.resolveBatch();
  assert.equal(game.state,'play','clearing level 1 does not end the run');
  assert.equal(game.settings.level,1,'advanced to the next authored level');
  assert.ok(game.grid.size>0,'the next board was built');
  const carried=game.score;
  assert.ok(carried>0,'the accuracy/headroom bonus was awarded');
  assert.equal(game.players[0].stats.shots,10,'per-player stats survive the level change');
  assert.equal(game.missMeter,0,'the miss meter resets with the fresh board');
  // Walk out the rest of the chain; only the last level ends the run.
  for(let i=1;i<4;i++){game.grid=new Map();game.batch=[];game.resolveBatch();}
  assert.equal(game.state,'won');
  assert.equal(game.settings.level,3,'stops on the last authored level');
  assert.ok(game.score>carried,'score accumulated across levels');
});

test('a custom level has nowhere to advance to and still ends the run', () => {
  const game=new OnlineGame({...DEFAULT_SETTINGS,mode:'clear',level:'custom',customText:'RRR'},[roster[0]],31);
  game.grid=new Map();game.batch=[];game.resolveBatch();
  assert.equal(game.state,'won');
  assert.equal(game.settings.level,'custom');
});

test('scoring rewards big cuts, cascades, and a solo chain', () => {
  const game=new OnlineGame(DEFAULT_SETTINGS,roster,3);
  // Superlinear pops: one 12 must beat four 3s, or there is no reason to set up.
  assert.equal(game.popPoints(3),30);
  assert.equal(game.popPoints(12),930); // 120 base + 9^2 * 10 over the minimum match
  assert.ok(game.popPoints(12)>4*game.popPoints(3));
  // Cascades: severing two clusters at once pays more than one cluster of the same size.
  assert.ok(game.dropPoints(6,2)>game.dropPoints(6,1));
  assert.equal(game.dropPoints(6,1),380);
  assert.equal(game.dropPoints(4,5),Math.round(4*30*3),'the cascade multiplier is capped at 3x');
  // Solo runs have nobody to hand the chain to, so consecutive clears must build it.
  const solo=new OnlineGame(DEFAULT_SETTINGS,[roster[0]],3);
  solo.registerClear(0);assert.equal(solo.chain.mult,2);
  solo.registerClear(0);assert.equal(solo.chain.mult,3);
  solo.registerClear(0);assert.equal(solo.chain.mult,4);
  solo.registerClear(0);assert.equal(solo.chain.mult,4,'still capped at 4x');
  // Co-op keeps the old hand-off rule: three in a row by one player drops it.
  game.registerClear(0);assert.equal(game.chain.mult,2);
  game.registerClear(0);game.registerClear(0);game.registerClear(0);
  assert.equal(game.chain.mult,1,'hogging the field resets the team chain');
});

test('disconnected launchers become idle and cannot fire', () => {
  const game=new OnlineGame(DEFAULT_SETTINGS,roster,8);
  game.input('a',{l:true});game.update(1/60);const angle=game.players[0].angle;
  game.setConnected('a',false);
  assert.equal(game.fire('a'),false);
  for(let i=0;i<20;i++)game.update(1/60);
  assert.equal(game.players[0].angle,angle);
});

test('aim speed is a room setting that scales how fast the launcher swings', () => {
  const swing = aimSpeed => {
    const game = new OnlineGame({ ...DEFAULT_SETTINGS, aimSpeed }, roster, 5);
    const from = game.players[0].angle;
    game.input('a', { r:true });
    for (let i = 0; i < 6; i++) game.update(1/60);
    return game.players[0].angle - from;
  };
  assert.ok(Math.abs(swing(4.8) - 2 * swing(2.4)) < 1e-9, 'double the setting, double the swing');
  assert.ok(swing(0.6) > 0 && swing(0.6) < swing(2.4));
  // A missing or junk value falls back to the speed the game shipped with.
  assert.ok(Math.abs(swing(undefined) - swing(2.4)) < 1e-9);
  assert.ok(Math.abs(swing('nonsense') - swing(2.4)) < 1e-9);
});

test('point-to-aim sends an angle, and the launcher glides onto it', () => {
  const game = new OnlineGame({ ...DEFAULT_SETTINGS }, roster, 5);
  game.input('a', {}, 0.8);
  for (let i = 0; i < 120; i++) game.update(1/60);
  assert.ok(Math.abs(game.players[0].angle - 0.8) < 0.01);
  // Out of range clamps to the launcher's limit; junk is ignored and hands back to held input.
  game.input('a', {}, 99);
  for (let i = 0; i < 200; i++) game.update(1/60);
  assert.ok(Math.abs(game.players[0].angle - 1.22) < 1e-6);
  game.input('a', { l:true }, 'not a number');
  assert.equal(game.players[0].aimTarget, null);
  for (let i = 0; i < 30; i++) game.update(1/60);
  assert.ok(game.players[0].angle < 1.22);
});
