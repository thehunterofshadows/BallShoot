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
