'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const component = fs.readFileSync(path.resolve(__dirname, '..', 'coop-bubbles.js'), 'utf8');

// The TV framework is pure data and arithmetic in one marked block, so run that block alone.
const block = component.match(/\/\* tv-display:begin[\s\S]*?\/\* tv-display:end \*\//);
assert.ok(block, 'tv-display block not found in coop-bubbles.js');
const tv = vm.runInNewContext(`${block[0]}
  ({ DISPLAY_MODES, TV, GAMEPAD, resolveDisplayMode, tvStage, TV_LAYOUTS, tvLayoutKey, tvLayout })`);
const { TV, resolveDisplayMode, tvStage, tvLayout, tvLayoutKey, TV_LAYOUTS } = tv;

const FIELD = 640 / 1080; // the world shape TV pins the field to
const inside = (r, box) => r.x >= box.x - 1e-6 && r.y >= box.y - 1e-6
  && r.x + r.w <= box.x + box.w + 1e-6 && r.y + r.h <= box.y + box.h + 1e-6;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const critical = lay => [lay.chromeL, lay.chromeR, lay.score, lay.round, lay.power, lay.pad, lay.info, ...lay.cards];

test('display setting offers Auto, Desktop and TV, and a forced choice always wins', () => {
  assert.deepEqual([...tv.DISPLAY_MODES], ['auto', 'desktop', 'tv']);
  const couch = { w: 1920, h: 1080, gamepad: true };
  assert.equal(resolveDisplayMode('tv', { w: 390, h: 844 }), 'tv');
  assert.equal(resolveDisplayMode('desktop', couch), 'desktop');
  for (const m of ['auto', 'desktop', 'tv']) assert.match(component, new RegExp(`data-d="${m}"`));
});

test('auto picks TV only for a big widescreen driven by a controller or no pointer', () => {
  assert.equal(resolveDisplayMode('auto', { w: 1920, h: 1080, gamepad: true }), 'tv');
  assert.equal(resolveDisplayMode('auto', { w: 3840, h: 2160, noPointer: true }), 'tv');
  assert.equal(resolveDisplayMode('auto', { w: 1920, h: 1080 }), 'desktop', 'a monitor with a mouse');
  assert.equal(resolveDisplayMode('auto', { w: 412, h: 915, gamepad: true }), 'desktop', 'a phone with a pad');
  assert.equal(resolveDisplayMode('auto', { w: 1600, h: 1200, gamepad: true }), 'desktop', '4:3 is not a TV shape');
  assert.equal(resolveDisplayMode(undefined, {}), 'desktop');
});

test('the display preference persists with the device prefs', () => {
  assert.match(component, /displayMode:'auto'/);
  assert.match(component, /DISPLAY_MODES\.includes\(p\.displayMode\)\) out\.displayMode = p\.displayMode/);
  assert.match(component, /const \{ aimSpeed, padTint, fireScale, aimMode, displayMode \} = this\.settings;/);
  assert.match(component, /JSON\.stringify\(\{ aimSpeed, padTint, fireScale, aimMode, displayMode \}\)/);
  assert.match(component, /setDisplayMode\(m\) \{[\s\S]{0,160}this\.saveLocalPrefs\(\)/);
});

test('1080p, 1440p and 4K get the same composition, only scaled', () => {
  const hd = tvStage(1920, 1080), qhd = tvStage(2560, 1440), uhd = tvStage(3840, 2160);
  assert.equal(hd.scale, 1); assert.equal(uhd.scale, 2); assert.ok(Math.abs(qhd.scale - 4 / 3) < 1e-9);
  for (const st of [hd, qhd, uhd]) {
    assert.equal(st.x, 0); assert.equal(st.y, 0);
    assert.deepEqual(st.safe, hd.safe, 'the safe area is in logical px, independent of resolution');
  }
  // The layout never sees the real resolution at all, so it cannot drift between them.
  assert.doesNotMatch(block[0], /innerWidth|devicePixelRatio|clientWidth/);
});

test('non-16:9 screens letterbox or pillarbox instead of stretching', () => {
  const wide = tvStage(3440, 1440); // 21:9
  assert.ok(Math.abs(wide.scale - 1440 / 1080) < 1e-9);
  assert.ok(wide.x > 0 && wide.y === 0, 'pillarboxed');
  assert.ok(Math.abs(wide.w / wide.h - 16 / 9) < 1e-9);
  const tall = tvStage(1600, 1200); // 4:3
  assert.ok(tall.y > 0 && tall.x === 0, 'letterboxed');
  assert.ok(Math.abs(tall.w / tall.h - 16 / 9) < 1e-9);
  assert.ok(Math.abs(tall.x * 2 + tall.w - 1600) < 1e-9 && Math.abs(tall.y * 2 + tall.h - 1200) < 1e-9, 'centred');
});

test('critical UI sits inside the 5% safe area and never on the playfield', () => {
  assert.equal(TV.safeArea, 0.05);
  const st = tvStage(1920, 1080);
  assert.deepEqual({ ...st.safe }, { x: 96, y: 54, w: 1728, h: 972 });
  for (const key of Object.keys(TV_LAYOUTS)) for (const n of [1, 2, 3, 4]) {
    const lay = tvLayout(key, FIELD, n);
    for (const r of critical(lay)) {
      assert.ok(inside(r, st.safe), `${key}/${n}: ${JSON.stringify(r)} leaves the safe area`);
      assert.ok(!overlaps(r, lay.playfield), `${key}/${n}: ${JSON.stringify(r)} covers the playfield`);
    }
    for (let i = 0; i < lay.cards.length; i++) for (let j = i + 1; j < lay.cards.length; j++)
      assert.ok(!overlaps(lay.cards[i], lay.cards[j]), `${key}/${n}: player cards overlap`);
  }
});

test('two-player co-op has its own layout: a dominant field framed by one card per player', () => {
  assert.equal(tvLayoutKey('clear', 2), 'coop2');
  assert.equal(tvLayoutKey('endless', 2), 'coop2');
  assert.equal(tvLayoutKey('clear', 4), 'coop');
  assert.equal(tvLayoutKey('battle', 2), 'battle');
  const lay = tvLayout('coop2', FIELD, 2), pf = lay.playfield;
  assert.equal(lay.cards.length, 2);
  assert.ok(lay.cards[0].x + lay.cards[0].w <= pf.x && lay.cards[1].x >= pf.x + pf.w, 'P1 left of the field, P2 right');
  assert.ok(lay.score.x < pf.x && lay.round.x > pf.x + pf.w, 'score and round frame the top');
  // The field keeps the world's shape and fills the stage height — more than the safe
  // height it would get as a padded desktop board.
  assert.ok(Math.abs(pf.w / pf.h - FIELD) < 1e-9);
  assert.equal(pf.h, Math.min(1080, 972 * TV.playfieldScale));
  assert.ok(pf.h > 972, 'the playfield is larger than a safe-inset board');
  assert.ok(Math.abs(pf.x + pf.w / 2 - 960) < 1e-9, 'centred');
  assert.ok(lay.cards[0].h > tvLayout('coop', FIELD, 4).cards[0].h, 'couch cards are bigger than the 4-player ones');
});

test('a taller online field narrows the playfield without breaking the frame', () => {
  const lay = tvLayout('coop2', 640 / 1560, 2);
  assert.ok(lay.playfield.w < tvLayout('coop2', FIELD, 2).playfield.w);
  for (const r of critical(lay)) assert.ok(!overlaps(r, lay.playfield));
});

test('TV tuning values are centralized', () => {
  for (const [k, v] of Object.entries({ safeArea: 0.05, hudScale: 1.35, menuScale: 1.40, playfieldScale: 1.15,
    hideSecondaryHud: true, preferFullscreen: true, logicalW: 1920, logicalH: 1080 })) assert.equal(TV[k], v, k);
  // The runtime reads them from TV rather than repeating the numbers.
  assert.match(component, /set\('--tvHudS', TV\.hudScale\)/);
  assert.match(component, /set\('--tvMenuK', \(st\.scale \* TV\.menuScale\)/);
  assert.match(component, /TV\.hideSecondaryHud/);
  assert.match(component, /TV\.preferFullscreen/);
});

test('new modes plug in as a layout spec, reusing stage, safe area and scaling', () => {
  // A future layout is only data: the framework builds any spec it is given.
  const ctx = vm.createContext({});
  vm.runInContext(`${block[0]}; TV_LAYOUTS.versus = { cards: 2, cardH: 240, hud: true };
    this.out = tvLayout('versus', ${FIELD}, 2);`, ctx);
  const st = tvStage(1920, 1080);
  assert.equal(ctx.out.key, 'versus');
  for (const r of critical(ctx.out)) assert.ok(inside(r, st.safe));
});

test('the canvas HUD steps aside for the TV HUD, and secondary detail waits for a pause', () => {
  assert.match(component, /if \(this\.tvActive && this\.tvLay && this\.tvLay\.hud\) return;/);
  assert.match(component, /const calm = !TV\.hideSecondaryHud \|\| this\.state !== 'play'/);
  assert.match(component, /\.tvInfo:not\(\.calm\)\{visibility:hidden\}/);
  assert.match(component, /this\.syncTvHud\(\);/);
});

test('fullscreen is only requested from user actions and never ends TV mode', () => {
  assert.match(component, /class="btn primary tvOnly tvFullscreen"/);
  // Nothing requests fullscreen on load or from the frame loop.
  const frame = component.match(/  frame\(t\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(frame, /Fullscreen/);
  assert.doesNotMatch(component.match(/  connectedCallback\(\) \{[\s\S]*?\n  \}/)[0], /Fullscreen/);
  // Exiting only marks the prompt declined; it does not touch the display setting.
  const sync = component.match(/const syncFullscreenButton = \(\) => \{[\s\S]*?\n    \};/)[0];
  assert.match(sync, /this\._fsDeclined = true/);
  assert.doesNotMatch(sync, /displayMode|tvActive/);
});

test('menus scale for the couch and focus is unmistakable', () => {
  assert.match(component, /\.root\.tvMode \.card\{[^}]*transform:scale\(var\(--tvMenuK\)\)/);
  assert.match(component, /\.root\.tvMode :is\(button,select,input,textarea,summary\):focus\{outline:4px solid/);
  assert.match(component, /\.root\.tvMode \.side\.open\{[^}]*transform:scale\(var\(--tvMenuK\)\)/);
});

test('controllers drive play and every menu', () => {
  const { btn } = tv.GAMEPAD;
  assert.equal(btn.a, 0); assert.equal(btn.b, 1); assert.equal(btn.start, 9);
  assert.match(component, /this\.pollGamepads\(\);/);
  assert.match(component, /navigator\.getGamepads/);
  for (const m of ['menuRoot', 'menuMove', 'menuActivate', 'menuBack', 'padPlay', 'padStart'])
    assert.match(component, new RegExp(`  ${m}\\(`), m);
  // Pads map onto the existing per-player input streams rather than a new one.
  assert.match(component, /this\.requestPass\(i\)/);
  assert.match(component, /this\.requestTeamPower\(i\)/);
});
