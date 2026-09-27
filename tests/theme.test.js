'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const component = fs.readFileSync(path.join(root, 'coop-bubbles.js'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

const block = component.match(/\/\* theme:begin[\s\S]*?\/\* theme:end \*\//);
assert.ok(block, 'theme block not found in coop-bubbles.js');
const method = name => {
  const m = component.match(new RegExp(`^  ${name}\\([^)]*\\) \\{[\\s\\S]*?^  \\}$`, 'm'));
  assert.ok(m, `${name}() not found`); return m[0];
};

/* The theme block and the cabinet methods, run against a recording canvas. `loaded` picks
   which art "arrived", so the fallback paths run exactly as they would in a browser. */
const harness = (loaded = { glass: [1024, 1365], left: [724, 2172], right: [724, 2172], deck: [1024, 341] }) => {
  const ctx = { calls: [], save() {}, restore() {}, translate() {}, scale() {}, fill() {}, stroke() {},
    fillRect(...a) { this.calls.push(['fillRect', ...a]); },
    createLinearGradient: () => ({ addColorStop() {} }),
    drawImage(img, ...a) { this.calls.push(['drawImage', img.id, ...a]); } };
  const src = `const BUILD_STAMP = 'stamp'; const W = 640;
    ${block[0]}
    for (const [id, [w, h]] of Object.entries(loaded)) THEME_SPRITES[id] = { id, complete: true, naturalWidth: w, naturalHeight: h };
    const game = { rrect() {}, ${method('drawGlass')}, ${method('deckFit')}, ${method('drawRail')} };
    ({ THEME_URLS, THEME_ART, THEME_SPRITES, themeImg, game })`;
  return { ctx, ...vm.runInNewContext(src, { encodeURIComponent, loaded }) };
};

test('all seven theme assets exist, are cache-busted with the build stamp and ship in the image', () => {
  const { THEME_URLS } = harness();
  const files = ['fantasy-night', 'playfield-glass', 'frame-top', 'frame-left', 'frame-right', 'frame-bottom', 'launcher-deck'];
  const urls = Object.values(THEME_URLS);
  assert.equal(urls.length, 7);
  for (const f of files) {
    const url = urls.find(u => u.startsWith(`assets/theme/${f}.webp?v=`));
    assert.ok(url, `${f} is not loaded from assets/theme/`);
    assert.ok(url.endsWith('?v=stamp'), `${f} is not cache-busted with the build stamp`);
    assert.ok(fs.statSync(path.join(root, 'assets/theme', `${f}.webp`)).size > 0, `${f}.webp missing`);
  }
  assert.match(dockerfile, /COPY assets \/usr\/share\/nginx\/html\/assets\//);
  // Preloaded and decoded with the other sprites; the root background uses the same URL.
  assert.match(component, /\.\.\.Object\.values\(THEME_SPRITES\)\]\)/);
  assert.match(component, /url\(\$\{THEME_URLS\.background\}\) center\/cover no-repeat/);
});

test('the theme is presentation only: field geometry is untouched and the marquee stays above the grid', () => {
  assert.match(component, /^const W = 640, R = 28, COLS = 11;$/m);
  assert.match(component, /^const ROWH = R \* Math\.sqrt\(3\), X0 = 12, GRIDTOP0 = 108;$/m);
  assert.match(component, /VIEWH_MAX = 1560, LAUNCH_GAP = 142, DANGER_GAP = 92;/);
  const { THEME_ART } = harness();
  assert.ok(THEME_ART.top.floor <= 108, 'marquee reaches the first row');
  // The theme never assigns simulation state.
  assert.doesNotMatch(block[0], /this\./);
});

test('the glass never stretches more than a few percent from 1080 to 1560 tall', () => {
  for (let h = 1080 - 60; h <= 1560 - 60; h += 20) {
    const { ctx, game } = harness();
    game.drawGlass(ctx, 6, 92, 628, h);
    const draws = ctx.calls.filter(c => c[0] === 'drawImage');
    let covered = 0;
    draws.forEach(([, id, , , sw, sh, , , dw, dh], i) => {
      assert.equal(id, 'glass');
      assert.equal(dw, 628);
      if (i < draws.length - 1) dh -= 0.6; // seam overlap
      const k = dh / sh / (628 / sw); // vertical vs horizontal scale
      assert.ok(Math.abs(k - 1) < 0.12, `h ${h}: vertical scale ${k.toFixed(3)} distorts the glass`);
      covered += dh;
    });
    assert.ok(Math.abs(covered - h) < draws.length, `h ${h}: glass covers ${covered}`);
  }
});

test('rails grow by whole tube sections instead of stretching', () => {
  for (const y1 of [776, 1016, 1256]) {
    const { ctx, game, THEME_ART, themeImg } = harness();
    game.drawRail(ctx, themeImg('left'), THEME_ART.rails.left, THEME_ART.rails.top, y1);
    const draws = ctx.calls.filter(c => c[0] === 'drawImage');
    const sc = THEME_ART.rails.scale;
    for (const [, , , , , sh, , , , dh] of draws) {
      const k = dh / (sh * sc);
      assert.ok(k > 0.85 && k < 1.18, `rail to ${y1}: vertical scale ${k.toFixed(3)}`);
    }
    assert.ok(draws.length >= 3);
  }
});

test('the two-socket deck is used only when both live launchers sit in its sockets', () => {
  const { game } = harness();
  const at = (xs, WW = 640) => Object.assign(Object.create(game), {
    WW, camX: 0, LAUNCH_Y: 938, players: xs.map(x => ({ x })) }).deckFit();
  const two = at([160, 480]);
  assert.ok(two, 'classic two-player co-op uses the deck');
  const { THEME_ART } = harness(), D = THEME_ART.deck;
  // Both sockets land on the launchers.
  assert.ok(Math.abs(two.x + D.sockets[0] * two.s - 160) < 1e-9);
  assert.ok(Math.abs(two.x + D.sockets[1] * two.s - 480) < 1e-9);
  assert.equal(at([107, 320, 533]), null, 'three players keep the lower frame');
  assert.equal(at([80, 240, 400, 560]), null, 'four players keep the lower frame');
  assert.equal(at([320]), null, 'battle board keeps the lower frame');
  assert.equal(at([640, 1920], 2560), null, 'wide field keeps the lower frame');
  // Missing deck art falls back rather than failing.
  const bare = harness({}).game;
  assert.equal(Object.assign(Object.create(bare), { WW: 640, camX: 0, LAUNCH_Y: 938, players: [{ x: 160 }, { x: 480 }] }).deckFit(), null);
});

test('without the glass art the field still gets a procedural chamber', () => {
  const { ctx, game } = harness({});
  game.drawGlass(ctx, 6, 92, 628, 878);
  assert.ok(ctx.calls.some(c => c[0] === 'fillRect'));
  assert.ok(!ctx.calls.some(c => c[0] === 'drawImage'));
});
