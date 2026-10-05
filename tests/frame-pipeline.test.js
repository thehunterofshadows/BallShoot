'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const component = fs.readFileSync(path.join(root, 'coop-bubbles.js'), 'utf8');
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

const block = component.match(/\/\* frame-pipeline:begin[\s\S]*?\/\* frame-pipeline:end \*\//);
assert.ok(block, 'frame-pipeline block not found in coop-bubbles.js');
const { FRAME, simSteps, cadence, TRAIL_DT } = vm.runInNewContext(
  `${block[0]} ({ FRAME, simSteps, cadence, TRAIL_DT })`);
const aimTick = (() => {
  const m = component.match(/^const AIM_MAX = [\s\S]*?^};$/m);
  assert.ok(m, 'aimTick not found in coop-bubbles.js');
  return vm.runInNewContext(`const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)); ${m[0]} aimTick`);
})();
const frameBody = (() => {
  const m = component.match(/^  frame\(t\) \{[\s\S]*?^  \}$/m);
  assert.ok(m, 'frame() not found'); return m[0];
})();

/* Presents `seconds` of play at `hz`, feeding each frame's steps to `step(h)`, exactly as
   frame() does. Returns the total simulated time and step count. */
const present = (hz, seconds, step, simHz = FRAME.simHz) => {
  let sim = 0, steps = 0;
  for (let f = 0; f < Math.round(hz * seconds); f++) {
    const { n, h } = simSteps(1 / hz, simHz);
    for (let s = 0; s < n; s++) { step(h); sim += h; steps++; }
  }
  return { sim, steps };
};
// The falling-bubble integrator from update(): gravity, semi-implicit Euler.
const fall = (hz, simHz) => { const f = { y: 0, vy: 0 };
  present(hz, 1, h => { f.vy += 1900 * h; f.y += f.vy * h; }, simHz); return f.y; };

test('frames split into equal steps no longer than 1/simHz, covering all elapsed time', () => {
  for (const hz of [30, 50, 60, 75, 90, 120, 144, 165, 240]) {
    const { n, h } = simSteps(1 / hz);
    assert.ok(h <= 1 / FRAME.simHz + 1e-12, `${hz} Hz step ${h}`);
    assert.ok(Math.abs(n * h - 1 / hz) < 1e-12, `${hz} Hz frame fully simulated`);
  }
  // A 60 Hz frame is two 120 Hz steps, not three from float noise; a 144 Hz frame is one.
  assert.equal(simSteps(1 / 60).n, 2);
  assert.equal(simSteps(1 / 120).n, 1);
  assert.equal(simSteps(1 / 144).n, 1);
  assert.deepEqual({ ...simSteps(0) }, { n: 0, h: 0 });
  assert.deepEqual({ ...simSteps(-1) }, { n: 0, h: 0 });
  // A long stall (tab switch) is dropped rather than fast-forwarded through dozens of steps.
  const stall = simSteps(5);
  assert.ok(Math.abs(stall.n * stall.h - FRAME.maxFrameDt) < 1e-12);
  assert.ok(stall.n <= Math.ceil(FRAME.maxFrameDt * FRAME.simHz));
});

test('gameplay speed is the same at 60, 120 and 144 Hz presentation', () => {
  for (const hz of [60, 90, 120, 144, 165]) {
    const { sim } = present(hz, 2, () => {});
    assert.ok(Math.abs(sim - 2) < 1e-9, `${hz} Hz simulates 2 s in 2 s (got ${sim})`);
  }
  // A held aim key turns the barrel through the same angle whatever the display does.
  const sweep = hz => { const p = { angle: -1, held: { l: false, r: true }, heldT: 0, heldDir: 0 };
    present(hz, 0.5, h => aimTick(p, h, 2.4)); return p.angle; };
  const a60 = sweep(60);
  for (const hz of [120, 144]) assert.ok(Math.abs(sweep(hz) - a60) < 0.005, `${hz} Hz aim matches 60 Hz`);
});

test('the 120 Hz step bound is a measured gain in cross-refresh consistency', () => {
  // With one step per frame (the old loop) a falling bubble lands ~9 units apart at 60 vs
  // 144 Hz; bounded at 120 Hz steps the gap shrinks several-fold. That is why simHz is 120.
  const gap = simHz => Math.abs(fall(60, simHz) - fall(144, simHz));
  const oneStep = gap(60), bounded = gap(FRAME.simHz);
  assert.ok(oneStep > 5, `one step per frame differs by ${oneStep.toFixed(2)}`);
  assert.ok(bounded < oneStep / 4, `bounded steps differ by ${bounded.toFixed(2)}`);
  assert.ok(bounded < 2);
  // 240 is available for comparison but is not the default.
  assert.ok(gap(240) <= bounded + 1e-9);
  assert.equal(FRAME.simHz, 120);
  assert.deepEqual([...FRAME.simHzRange], [60, 480]);
});

test('cadence reports the rate the display actually presents at', () => {
  const at = (hz, jitter = 0) => Array.from({ length: 90 }, (_, i) => 1000 / hz + (i % 2 ? jitter : -jitter));
  assert.equal(cadence(at(60, 0.3)).hz, 60);
  assert.equal(cadence(at(120, 0.2)).hz, 120);
  assert.equal(cadence(at(144, 0.1)).hz, 144);
  assert.equal(cadence(at(59.94)).hz, 60);
  // A few hitches do not drag the reading down.
  const hitchy = at(120); hitchy[10] = 50; hitchy[40] = 33;
  assert.equal(cadence(hitchy).hz, 120);
  // A rate that matches no display is reported as measured, not snapped.
  assert.equal(cadence(at(83)).hz, 83);
  assert.deepEqual({ ...cadence([]) }, { fps: 0, hz: 0 });
});

test('frame() reads input first, simulates, renders, then touches the DOM', () => {
  const order = ['pollGamepads()', 'simSteps(', 'this.update(h)', 'this.render()', 'syncMenuFocus()', 'syncTvHud()', 'syncPassButton()'];
  let at = -1;
  for (const k of order) { const i = frameBody.indexOf(k); assert.ok(i > at, `${k} in order`); at = i; }
  assert.ok(frameBody.indexOf('this.battleUpdate(h)') < frameBody.indexOf('this.battleRender()'));
  assert.match(frameBody, /requestAnimationFrame/);
});

test('no fixed 60 Hz assumptions or frame caps in the presentation loop', () => {
  assert.doesNotMatch(frameBody, /0\.033|16\.6|1 ?\/ ?60/, 'no hard-coded frame time');
  assert.doesNotMatch(component, /setInterval\(/, 'no timer-driven gameplay');
  assert.doesNotMatch(frameBody, /setTimeout/);
  // The loop never skips a presented frame to hold a rate.
  assert.doesNotMatch(frameBody, /return;/);
});

test('cosmetic state stays off the simulation clock', () => {
  // Trails sample on their own clock so their on-screen length does not depend on steps.
  assert.equal(TRAIL_DT, 1 / 60);
  assert.match(component, /f\.trailT = \(f\.trailT \?\? TRAIL_DT\) \+ dt;/);
  const trail = hz => { const f = { trail: [], trailT: undefined }; let x = 0;
    present(hz, 0.5, h => { x += h; f.trailT = (f.trailT ?? TRAIL_DT) + h;
      if (f.trailT >= TRAIL_DT) { f.trailT = Math.min(f.trailT - TRAIL_DT, TRAIL_DT); f.trail.push(x); } });
    return f.trail.length; };
  for (const hz of [60, 120, 144]) assert.ok(Math.abs(trail(hz) - 30) <= 1, `${hz} Hz trail samples at 60/s`);
  // Firing launches the shot in the same call; recoil and shake are drawn, never simulated.
  const fire = component.match(/^  fire\(i\) \{[\s\S]*?^  \}$/m)[0];
  assert.ok(fire.indexOf('this.flights.push') < fire.indexOf('p.recoilT = this.now'));
  assert.ok(fire.indexOf('this.flights.push') < fire.indexOf("this.sfx('launch')"));
  assert.match(component, /if \(this\.shake > 0\) ctx\.translate\(/);
});

test('assets, audio and diagnostics are wired for latency', () => {
  assert.match(component, /warmAssets\(\) \{[\s\S]*?img\.decode\(\)/);
  assert.match(component, /document\.fonts\.load/);
  assert.match(component, /latencyHint: 'interactive'/);
  assert.match(component, /this\.warmAssets\(\);/);
  // Diagnostics: ?perf or F9, with cadence, frame, input→render, sim and render timing.
  assert.match(component, /q\.has\('perf'\)/);
  assert.match(component, /e\.key === 'F9'/);
  for (const k of ['present ', 'frame ', 'input→render', 'steps/s', 'render ']) assert.ok(component.includes(k), k);
  // Listeners registered for diagnostics are removed with the component.
  assert.match(component, /removeEventListener\(type, seen, seenOpts\)/);
});

test('AGENTS.md carries the responsiveness guardrails', () => {
  assert.match(agents, /### Gameplay Responsiveness/);
  for (const k of ['never wait for cosmetic animation', 'freshest available player input', 'requestAnimationFrame',
    'refresh-independent', 'DOM/layout', 'trigger audio from gameplay events']) assert.ok(agents.includes(k), k);
});

/* A clear is decided on the clearing shot, but its card waits for the last drop to land, so
   the finishing cut is seen falling instead of freezing under the scoreboard. */
test('a cleared board plays out its final drop before the card shows', () => {
  const method = name => { const m = component.match(new RegExp(`^  ${name}\\([^)]*\\) \\{[\\s\\S]*?^  \\}$|^  ${name}\\([^)]*\\) \\{.*\\}$`, 'm'));
    assert.ok(m, `${name}() not found`); return m[0].trim(); };
  const max = Number(component.match(/^const OUTRO_MAX = ([\d.]+);/m)?.[1]);
  assert.ok(max > 0.8 && max <= 2, 'OUTRO_MAX keeps the wait short');
  const Game = vm.runInNewContext(`const OUTRO_MAX=${max}; (class { ${method('beginOutro')} ${method('tickOutro')} })`);
  const g = new Game(); g.now = 0; g.falling = [{}]; g.pops = [{}];
  let shown = 0; g.beginOutro(() => shown++);
  g.tickOutro(); assert.equal(shown, 0, 'card waits while bubbles are still falling');
  g.falling = []; g.pops = []; g.tickOutro(); assert.equal(shown, 1, 'card shows once the drop has landed');
  g.tickOutro(); assert.equal(shown, 1, 'and only once');
  g.falling = [{}]; g.beginOutro(() => shown++); g.now = max; g.tickOutro();
  assert.equal(shown, 2, 'OUTRO_MAX is a hard cap');

  assert.match(method('clearLevel'), /beginOutro\(\(\) => this\.showLevelCard/, 'clearLevel gates its card');
  assert.match(method('endGame'), /beginOutro\(\(\) => this\.showEnd/, 'endGame gates its card');
  assert.match(frameBody, /this\._outro\) \{ this\.now \+= h; this\.stepFx\(h\);/, 'frame() keeps FX running after the clear');
  assert.match(frameBody, /this\.tickOutro\(\)/);
  assert.match(component, /present\(\(\)=>this\.showLevelCard/, 'online level card is gated too');
});

for (const [name, tick] of [['browser', aimTick], ['server', require('../server/game').aimTick]]) {
  test(`${name}: analog speed is immediate, constant and reverses without acceleration`, () => {
    for (const magnitude of [0.05, 0.5, 1]) {
      const p = { angle: 0, held: { analog: magnitude }, heldT: 10, heldDir: -1 };
      for (let i = 0; i < 100; i++) {
        p.angle = 0;
        tick(p, 0.01, 2.4);
        assert.ok(Math.abs(p.angle - magnitude * 0.024) < 1e-12);
        assert.equal(p.heldT, 0);
      }
      p.angle = 0; p.held.analog = -magnitude;
      tick(p, 0.01, 2.4);
      assert.ok(Math.abs(p.angle + magnitude * 0.024) < 1e-12);
    }
  });
  test(`${name}: independent sticks and digital ramp retain their own speeds`, () => {
    const a = { angle: 0, held: { analog: 0.2 } };
    const b = { angle: 0, held: { analog: -0.8 } };
    tick(a, 0.1, 2.4); tick(b, 0.1, 2.4);
    assert.ok(Math.abs(a.angle - 0.048) < 1e-12);
    assert.ok(Math.abs(b.angle + 0.192) < 1e-12);
    const digital = { angle: 0, held: { r: true }, heldT: 0, heldDir: 0 };
    tick(digital, 0.01, 2.4);
    assert.ok(Math.abs(digital.angle - 0.006) < 1e-12);
    for (let i = 0; i < 60; i++) { digital.angle = 0; tick(digital, 0.01, 2.4); }
    assert.ok(Math.abs(digital.angle - 0.024) < 1e-12);
  });
}
