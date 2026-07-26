'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const component = fs.readFileSync(path.join(root, 'coop-bubbles.js'), 'utf8');

// The guide is canvas drawing inside the component's IIFE, so lift the two pure pieces of
// it out of the source rather than standing up a DOM to reach them.
const lift = name => {
  const src = component.match(new RegExp(`^const ${name} = [\\s\\S]*?^};$`, 'm'))
    || component.match(new RegExp(`^const ${name} = .*$`, 'm'));
  assert.ok(src, `${name} not found in coop-bubbles.js`);
  return vm.runInNewContext(`const R = 28; ${src[0]} ${name}`);
};
const trimPath = lift('trimPath');
const GUIDE_STUB = lift('GUIDE_STUB');

// A straight sampled path, matching simulate()'s 14-unit point spacing.
const straight = steps => Array.from({ length: steps + 1 }, (_, i) => ({ x: 100, y: 900 - i * 14 }));
const pathLength = pts => pts.reduce((n, q, i) => i ? n + Math.hypot(q.x - pts[i-1].x, q.y - pts[i-1].y) : 0, 0);

test('a shortened aim guide is a fixed length, not a share of the flight path', () => {
  // The bug: 25% of a long path drew a long stub and 25% of a short path drew a stub too
  // small to aim with, so the guide's length told you how far away the target was.
  for (const frac of [0.5, 0.25]) {
    const near = trimPath(straight(6), GUIDE_STUB[frac]);   // target ~84 units away
    const far = trimPath(straight(60), GUIDE_STUB[frac]);   // target ~840 units away
    assert.ok(Math.abs(pathLength(far) - GUIDE_STUB[frac]) < 1e-6, `${frac} guide is its stated length`);
    assert.ok(pathLength(near) <= pathLength(far) + 1e-6);
    // A path shorter than the stub is drawn whole rather than extrapolated past the target.
    assert.ok(pathLength(near) <= pathLength(straight(6)) + 1e-6);
  }
});

test('25% sticks out less than 50%, and both stay well short of a full shot', () => {
  assert.ok(GUIDE_STUB[0.25] < GUIDE_STUB[0.5]);
  assert.ok(GUIDE_STUB[0.25] >= 2 * 28, 'still at least a bubble or two of direction');
  assert.ok(GUIDE_STUB[0.5] < 400, 'a stub off the barrel, not most of the field');
});

test('the guide keeps its start point and cuts exactly on the length budget', () => {
  const pts = trimPath(straight(60), 100);
  assert.deepEqual(pts[0], { x: 100, y: 900 });
  assert.ok(Math.abs(pathLength(pts) - 100) < 1e-6, 'the last point is interpolated, not rounded to a sample');
  assert.deepEqual(trimPath([{ x: 1, y: 2 }], 100), [{ x: 1, y: 2 }]);
});

test('only the full guide reveals bounce markers and the landing ghost', () => {
  assert.match(component, /if \(frac >= 1\) for \(const b of sim\.bpts\)/);
  assert.match(component, /if \(frac >= 1 && sim\.cell\)/);
  // The old proportional slice is gone.
  assert.doesNotMatch(component, /sim\.pts\.slice\(0, Math\.max\(2, Math\.ceil\(sim\.pts\.length \* frac\)\)\)/);
});

test('every mode reaches the same aim integrator, and it is the same code on both sides', () => {
  // Local co-op (update), local battle (boardTick) and both online prediction paths call the
  // one integrator; the server's OnlineGame — which BattleGame builds one of per board — runs
  // a byte-identical copy, so prediction and authority cannot drift apart.
  assert.equal((component.match(/aimTick\(p, rdt, this\.settings\.aimSpeed\)/g) || []).length, 2);
  assert.match(component, /predictOwnAim\(p, dt\)/);
  const server = fs.readFileSync(path.join(root, 'server', 'game.js'), 'utf8');
  const battle = fs.readFileSync(path.join(root, 'server', 'battle.js'), 'utf8');
  assert.match(server, /aimTick\(p, dt, this\.settings\.aimSpeed\)/);
  assert.match(battle, /new OnlineGame\(this\.settings,/);
  const body = src => { const m = src.match(/^const aimTick = [\s\S]*?^};$/m); assert.ok(m); return m[0]; };
  assert.equal(body(component), body(server), 'the client mirror and the server authority must match');
  assert.match(component, /<label>Aim speed<input data-setting="aimSpeed"/);
  // Leaving a room hands the device preferences back rather than keeping the host's.
  assert.match(component, /returnHome\(\)\{[^}]*this\.restoreLocalPrefs\(\)/);
});

// The integrator is pure, so lift it out of the component and drive it directly.
const aimTick = (() => {
  const m = component.match(/^const AIM_MAX = [\s\S]*?^};$/m);
  assert.ok(m, 'aimTick not found in coop-bubbles.js');
  return vm.runInNewContext(`const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)); ${m[0]} aimTick`);
})();
const run = (p, seconds, speed = 2.4, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) aimTick(p, dt, speed);
  return p;
};

test('held aim ramps up to speed instead of stepping on at full rate', () => {
  const p = { angle: 0, held: { l: false, r: true } };
  aimTick(p, 1 / 60, 2.4);
  assert.ok(p.aimVel > 0 && p.aimVel < 2.4 * 0.5, 'the first frame is a fraction of full speed');
  run(p, 0.2);
  assert.ok(Math.abs(p.aimVel - 2.4) < 1e-6, 'full speed within a fifth of a second');
  // And it coasts to a stop rather than freezing mid-sweep.
  p.held.r = false;
  const atRelease = p.angle;
  run(p, 0.5);
  assert.equal(p.aimVel, 0);
  assert.ok(p.angle - atRelease > 0 && p.angle - atRelease < 0.06, 'a short, controllable coast');
});

test('aim stops at the launcher limits without winding up against them', () => {
  const p = { angle: 0, held: { l: false, r: true } };
  run(p, 5);
  assert.ok(Math.abs(p.angle - 1.22) < 1e-9);
  assert.equal(p.aimVel, 0, 'no stored velocity to fling the barrel back on release');
  p.held = { l: true, r: false };
  aimTick(p, 1 / 60, 2.4);
  assert.ok(p.angle < 1.22, 'turning the other way responds immediately');
});

test('point-to-aim glides onto the target and stays there', () => {
  const p = { angle: -0.9, held: { l: false, r: false }, aimTarget: 0.7 };
  run(p, 2);
  assert.ok(Math.abs(p.angle - 0.7) < 0.01, 'lands on the target');
  assert.ok(Math.abs(p.aimVel) < 0.05, 'and does not oscillate around it');
  // Out-of-range targets clamp to the launcher's limit rather than being chased.
  p.aimTarget = 9;
  run(p, 3);
  assert.ok(Math.abs(p.angle - 1.22) < 1e-6);
  // Clearing the target hands the launcher back to the held-direction stream.
  p.aimTarget = null; p.held = { l: true, r: false };
  const before = p.angle;
  run(p, 0.3);
  assert.ok(p.angle < before);
});

test('a faster aim speed setting is a faster sweep, not a different feel', () => {
  const slow = run({ angle: 0, held: { l: false, r: true } }, 0.3, 1.2);
  const fast = run({ angle: 0, held: { l: false, r: true } }, 0.3, 4.8);
  assert.ok(fast.angle > slow.angle * 2);
  assert.ok(Math.abs(fast.aimVel - 4.8) < 1e-6 && Math.abs(slow.aimVel - 1.2) < 1e-6);
});
