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
  ({ DISPLAY_MODES, FIT_EDGES, TV, GAMEPAD, resolveDisplayMode, normalizeScreenFit, tvStage, tvTooSmall, TV_LAYOUTS, tvLayoutKey, tvLayout, spatialPick })`);
const { TV, resolveDisplayMode, normalizeScreenFit, tvStage, tvTooSmall, tvLayout, tvLayoutKey, TV_LAYOUTS, spatialPick } = tv;

/* The whole component, loaded with just enough stubs to reach the class, so controller and
   Screen Fit behaviour can be driven on a hand-built instance without a browser. */
const loadComponent = (env = {}) => {
  let Cls;
  const ctx = { HTMLElement: class {}, customElements: { get: () => null, define: (n, c) => { Cls = c; } },
    document: env.document || { addEventListener() {}, removeEventListener() {} }, Image: class {},
    navigator: env.navigator || {}, performance: { now: () => env.now || 0 }, console,
    location: {}, localStorage: env.localStorage || { getItem: () => null, setItem() {} },
    setTimeout: () => 0, clearTimeout() {}, cancelAnimationFrame: () => {}, Event: class { constructor(t) { this.type = t; } },
    matchMedia: env.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
    get devicePixelRatio() { return env.getDpr ? env.getDpr() : (env.devicePixelRatio || 1); },
    getComputedStyle: env.getComputedStyle || (() => ({ paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0', getPropertyValue: () => '' })) };
  ctx.window = ctx;
  vm.runInNewContext(component, ctx);
  return Cls;
};

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

test('tvTooSmall holds at the minimum viewport boundaries', () => {
  assert.deepEqual({ ...TV.minViewport }, { w: 960, h: 540 });
  assert.equal(TV.auto.minW, 960);
  assert.equal(TV.auto.minH, 540);
  assert.equal(tvTooSmall(959, 540), true);
  assert.equal(tvTooSmall(960, 539), true);
  assert.equal(tvTooSmall(959, 539), true);
  assert.equal(tvTooSmall(960, 540), false);
  assert.equal(tvTooSmall(1920, 1080), false);
});

test('auto mode hysteresis maintains TV mode across the stay-aspect band [1.2, 3.6]', () => {
  assert.deepEqual([...TV.auto.stayAspect], [1.2, 3.6]);
  // An active TV session stays in TV when resized to 21:9, 16:10, 4:3
  assert.equal(resolveDisplayMode('auto', { w: 3440, h: 1440, gamepad: true, current: 'tv' }), 'tv', '21:9 stays TV');
  assert.equal(resolveDisplayMode('auto', { w: 1920, h: 1200, gamepad: true, current: 'tv' }), 'tv', '16:10 stays TV');
  assert.equal(resolveDisplayMode('auto', { w: 1600, h: 1200, gamepad: true, current: 'tv' }), 'tv', '4:3 stays TV');
  // Fresh Auto at 21:9 or 4:3 resolves to Desktop
  assert.equal(resolveDisplayMode('auto', { w: 3440, h: 1440, gamepad: true }), 'desktop', 'fresh 21:9 is desktop');
  assert.equal(resolveDisplayMode('auto', { w: 1600, h: 1200, gamepad: true }), 'desktop', 'fresh 4:3 is desktop');
  // Dropping below minimum viewport or losing controller leaves TV even with current: 'tv'
  assert.equal(resolveDisplayMode('auto', { w: 900, h: 500, gamepad: true, current: 'tv' }), 'desktop', 'below min drops to desktop');
  assert.equal(resolveDisplayMode('auto', { w: 1920, h: 1080, current: 'tv' }), 'desktop', 'loss of gamepad drops to desktop');
});

test('the display preference persists with the device prefs', () => {
  assert.match(component, /displayMode:'auto'/);
  assert.match(component, /DISPLAY_MODES\.includes\(p\.displayMode\)\) out\.displayMode = p\.displayMode/);
  assert.match(component, /const \{ aimSpeed, padTint, fireScale, aimMode, displayMode, screenFit \} = this\.settings;/);
  assert.match(component, /JSON\.stringify\(\{ aimSpeed, padTint, fireScale, aimMode, displayMode, screenFit \}\)/);
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

test('non-16:9 screens letterbox or pillarbox instead of stretching across the full matrix', () => {
  const MATRIX = [
    { w: 1920, h: 1080, name: '1080p' },
    { w: 2560, h: 1440, name: '1440p' },
    { w: 3840, h: 2160, name: '4K' },
    { w: 1920, h: 1200, name: '16:10' },
    { w: 2560, h: 1080, name: '21:9' },
    { w: 3440, h: 1440, name: '21:9 UW' },
    { w: 1600, h: 1200, name: '4:3' },
    { w: 1366, h: 768,  name: '1366x768' },
    { w: 1280, h: 1024, name: '5:4' },
    { w: 2200, h: 900,  name: '2200x900' },
  ];
  const refLayout = tvLayout('coop2', FIELD, 2);
  for (const { w: vw, h: vh, name } of MATRIX) {
    const st = tvStage(vw, vh);
    const expectedScale = Math.min(vw / 1920, vh / 1080);
    assert.ok(Math.abs(st.scale - expectedScale) < 1e-9, `${name}: scale`);
    assert.ok(Math.abs(st.w / st.h - 16 / 9) < 1e-9, `${name}: 16:9 stage aspect`);
    assert.ok(Math.abs(st.x * 2 + st.w - vw) < 1e-9, `${name}: centred horizontally`);
    assert.ok(Math.abs(st.y * 2 + st.h - vh) < 1e-9, `${name}: centred vertically`);
    const aspect = vw / vh;
    if (aspect > 16 / 9 + 1e-6) {
      assert.ok(st.x > 0 && Math.abs(st.y) < 1e-9, `${name}: pillarboxed`);
    } else if (aspect < 16 / 9 - 1e-6) {
      assert.ok(st.y > 0 && Math.abs(st.x) < 1e-9, `${name}: letterboxed`);
    } else {
      assert.ok(Math.abs(st.x) < 1e-9 && Math.abs(st.y) < 1e-9, `${name}: exact 16:9`);
    }
    // Layout output is strictly invariant to viewport size
    const lay = tvLayout('coop2', FIELD, 2);
    assert.deepEqual(lay, refLayout, `${name}: layout invariance`);
    assert.ok(Math.abs(lay.playfield.w / lay.playfield.h - FIELD) < 1e-9, `${name}: playfield aspect matches world`);
  }
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
  assert.match(component, /\.root\.tvMode :is\(button,select,input,textarea,summary\):focus\{outline:[5-9]px solid/);
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

/* ---------- issue #7: controller navigation, couch legibility, Screen Fit ---------- */

const FITS = [
  { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  { top: 0, right: 0, bottom: 0, left: 0 },
  { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
  { top: 0.1, right: 0, bottom: 0.02, left: 0.08 },
  { top: 0, right: 0.1, bottom: 0.1, left: 0 },
];
const layoutRects = lay => ({ L: [lay.chromeL, lay.score, lay.power, lay.pad, ...lay.cards.filter((_, i) => !(i % 2))],
  R: [lay.chromeR, lay.round, lay.info, ...lay.cards.filter((_, i) => i % 2)] });

test('Screen Fit defaults to a 5% safe area on every edge and is centralized', () => {
  assert.deepEqual([...tv.FIT_EDGES], ['top', 'right', 'bottom', 'left']);
  assert.deepEqual({ ...TV.screenFit }, { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 });
  for (const e of tv.FIT_EDGES) assert.equal(TV.screenFit[e], TV.safeArea);
  assert.equal(TV.controllerNavigation, true);
  assert.ok(TV.fit.min <= 0.05 && TV.fit.max >= 0.05 && TV.fit.step > 0);
  // The default calibrated stage is the old fixed 5% one.
  assert.deepEqual({ ...tvStage(1920, 1080).safe }, { x: 96, y: 54, w: 1728, h: 972 });
  assert.match(component, /screenFit:normalizeScreenFit\(TV\.screenFit\)/);
});

test('stored Screen Fit values are clamped, snapped and filled in', () => {
  assert.deepEqual({ ...normalizeScreenFit(null) }, { ...TV.screenFit });
  assert.deepEqual({ ...normalizeScreenFit({ top: 0.5, right: -1, bottom: 'x', left: 0.0731 }) },
    { top: TV.fit.max, right: TV.fit.min, bottom: 0.05, left: 0.075 });
  const odd = normalizeScreenFit({ top: 0.0333, right: NaN, bottom: Infinity, left: 0.02 });
  for (const e of tv.FIT_EDGES) {
    assert.ok(odd[e] >= TV.fit.min && odd[e] <= TV.fit.max, e);
    assert.ok(Math.abs(odd[e] / TV.fit.step - Math.round(odd[e] / TV.fit.step)) < 1e-6, `${e} snapped`);
  }
});

test('the safe rect follows each calibrated edge independently', () => {
  const st = tvStage(3840, 2160, TV, { top: 0.1, right: 0, bottom: 0.02, left: 0.08 });
  assert.equal(st.scale, 2, 'calibration never changes the stage scale');
  assert.deepEqual({ ...st.safe }, { x: 154, y: 108, w: 1920 - 154, h: 1080 - 108 - 22 });
});

test('every calibrated layout keeps critical UI inside the safe rect, off the field, unoverlapped', () => {
  for (const fit of FITS) for (const key of Object.keys(TV_LAYOUTS)) for (const n of [1, 2, 3, 4]) {
    const lay = tvLayout(key, FIELD, n, TV, fit), safe = tvStage(1920, 1080, TV, fit).safe, tag = `${key}/${n} ${JSON.stringify(fit)}`;
    for (const r of critical(lay)) {
      assert.ok(r.w >= 0 && r.h >= 0, `${tag}: negative rect`);
      assert.ok(inside(r, safe), `${tag}: ${JSON.stringify(r)} leaves the safe rect`);
      assert.ok(!overlaps(r, lay.playfield), `${tag}: ${JSON.stringify(r)} covers the playfield`);
    }
    for (const col of Object.values(layoutRects(lay))) {
      const live = col.filter(r => r.h > 0 && r.w > 0);
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++)
        assert.ok(!overlaps(live[i], live[j]), `${tag}: ${JSON.stringify(live[i])} overlaps ${JSON.stringify(live[j])}`);
    }
  }
});

test('calibration never distorts the playfield; the stage art keeps the whole viewport', () => {
  for (const fit of FITS) for (const aspect of [FIELD, 640 / 1560]) {
    const pf = tvLayout('coop2', aspect, 2, TV, fit).playfield;
    assert.ok(Math.abs(pf.w / pf.h - aspect) < 1e-9, 'same shape as the world');
    assert.ok(pf.x >= 0 && pf.y >= 0 && pf.x + pf.w <= 1920 + 1e-9 && pf.y + pf.h <= 1080 + 1e-9, 'on the stage');
  }
  // The background belongs to .root (the full viewport), with .gameCol transparent.
  assert.match(component, /\.root\.tvMode\{[^}]*background:var\(--worldBg\)/);
  assert.match(component, /\.root\.tvMode \.gameCol\{[^}]*background:transparent/);
  assert.doesNotMatch(component.match(/\.root\.tvMode \.gameCol\{[^}]*\}/)[0], /tvSafe/);
});

test('Screen Fit persists with the device prefs and drives every critical TV surface', () => {
  assert.match(component, /if \(p\.screenFit && typeof p\.screenFit === 'object'\) out\.screenFit = normalizeScreenFit\(p\.screenFit\)/);
  // The layout, HUD slots and stage all read the fit in force.
  assert.match(component, /tvStage\([^)]*, TV, fit\)/);
  assert.match(component, /tvLayout\(key, W \/ this\.H, n, TV, fit\)/);
  for (const v of ['--tvSafeX', '--tvSafeY', '--tvSafeW', '--tvSafeH', '--tvSafeR', '--tvSafeB']) assert.match(component, new RegExp(`set\\('${v}'`));
  // Corner buttons, drawer, menus and the prompt bar are placed from the calibrated edges.
  assert.match(component, /\.root\.tvMode \.fullscreenButton\{left:calc\(var\(--tvSafeX\)/);
  assert.match(component, /\.root\.tvMode \.gear\{[^}]*right:calc\(var\(--tvSafeR\)/);
  assert.match(component, /\.root\.tvMode \.side\.open\{[^}]*top:calc\(var\(--tvY\) \+ var\(--tvSafeY\)[^}]*right:calc\(var\(--tvX\) \+ var\(--tvSafeR\)/);
  assert.match(component, /\.root\.tvMode \.overlay\{[^}]*padding:calc\(var\(--tvSafeY\)[^}]*var\(--tvSafeR\)[^}]*var\(--tvSafeB\)[^}]*var\(--tvSafeX\)/);
  assert.match(component, /\.root\.tvMode \.tvPrompts\{[^}]*bottom:calc\(var\(--tvSafeB\)/);
  // A changed fit re-lays the HUD on the next frame.
  assert.match(component, /lay\.fit !== JSON\.stringify\(this\.screenFitNow\(\)\)/);
});

test('Screen Fit screen: corner marks, per-edge control, reset, save and cancel', () => {
  for (const q of ['class="overlay screenFit"', 'sfCorner tl', 'sfCorner tr', 'sfCorner bl', 'sfCorner br', 'class="sfRange"',
    'data-e="all"', 'data-e="top"', 'data-e="right"', 'data-e="bottom"', 'data-e="left"', 'sfReset', 'sfCancel', 'sfSave'])
    assert.ok(component.includes(q), q);
  // Reachable from home, pause and the settings drawer.
  assert.equal((component.match(/class="btn ghost tvOnly sfOpen"/g) || []).length, 3);
  assert.match(component, /\.sfFrame\{[^}]*left:var\(--tvSafeX\);top:var\(--tvSafeY\);width:var\(--tvSafeW\);height:var\(--tvSafeH\)/);

  const C = loadComponent(), P = C.prototype;
  const saved = [];
  const panel = { style: { display: 'none' }, dataset: {}, querySelectorAll: () => [], querySelector: () => ({ value: '', textContent: '' }) };
  const g = Object.assign(Object.create(P), {
    tvActive: true, screenFitEl: panel, online: false, state: 'paused',
    settings: { screenFit: { ...TV.screenFit } }, shadowRoot: { activeElement: null },
    saveLocalPrefs() { saved.push(JSON.parse(JSON.stringify(this.settings.screenFit))); },
    relayoutTv() {}, closeSide() {}, togglePause() {}, menuFocus() {},
  });
  g.openScreenFit();
  assert.equal(panel.style.display, 'grid');
  g.stepScreenFit(1); g.stepScreenFit(1);
  assert.deepEqual({ ...g.screenFitNow() }, { top: 0.06, right: 0.06, bottom: 0.06, left: 0.06 }, 'All moves every edge');
  g.cycleFitEdge(1); assert.equal(g._fitEdge, 'top');
  g.stepScreenFit(-1); g.stepScreenFit(-1); g.stepScreenFit(-1);
  assert.equal(g.screenFitNow().top, 0.045); assert.equal(g.screenFitNow().bottom, 0.06);
  g.setScreenFit(5); assert.equal(g.screenFitNow().top, TV.fit.max, 'clamped');
  // Cancel throws the draft away.
  g.closeScreenFit(false);
  assert.equal(panel.style.display, 'none'); assert.equal(saved.length, 0);
  assert.deepEqual({ ...g.screenFitNow() }, { ...TV.screenFit });
  // Save persists; Reset returns to the 5% default.
  g.openScreenFit(); g.cycleFitEdge(-1); assert.equal(g._fitEdge, 'left');
  g.setScreenFit(0.02); g.closeScreenFit(true);
  assert.deepEqual(saved.at(-1), { top: 0.05, right: 0.05, bottom: 0.05, left: 0.02 });
  g.openScreenFit(); g.resetScreenFit(); g.closeScreenFit(true);
  assert.deepEqual(saved.at(-1), { ...TV.screenFit });
  // Only a TV screen: nothing opens on the desktop layout.
  g.tvActive = false; g.openScreenFit(); assert.equal(panel.style.display, 'none');
});

test('TV typography has minimums, and every critical string uses the TV type table', () => {
  assert.equal(TV.minHudFontPx, 28); assert.equal(TV.minMenuFontPx, 30);
  for (const [k, v] of Object.entries(TV.hudType)) assert.ok(v >= TV.minHudFontPx, `hud ${k} ${v}px`);
  for (const [k, v] of Object.entries(TV.menuType)) assert.ok(v >= TV.minMenuFontPx, `menu ${k} ${v}px`);
  // Scaled menus are pre-divided by menuScale, so what reaches the screen is the table value.
  assert.match(component, /set\('--tvH-' \+ k, Math\.max\(TV\.minHudFontPx, v\) \+ 'px'\)/);
  assert.match(component, /set\('--tvM-' \+ k, \(Math\.max\(TV\.minMenuFontPx, v\) \/ TV\.menuScale\)/);
  for (const [sel, v] of [['.tvLabel', 'label'], ['.tvBig', 'big'], ['.tvRound .tvBig', 'roundBig'], ['.tvLine', 'line'], ['.tvName', 'name'],
    ['.tvCard .tvStatus', 'status'], ['.tvInfo .tvLine', 'info'], ['.tvChain', 'chain']])
    assert.match(component, new RegExp(`\\n${sel.replace(/\./g, '\\.')}\\{[^}]*font-size:var\\(--tvH-${v}\\)`), sel);
  assert.match(component, /\.root\.tvMode \.tvPrompts\{[^}]*var\(--tvH-prompt\)/);
  assert.match(component, /\.root\.tvMode \.card\{[^}]*font-size:var\(--tvM-body\)/);
  assert.match(component, /\.root\.tvMode \.card \.btn\{[^}]*font-size:var\(--tvM-button\)/);
  assert.match(component, /\.root\.tvMode \.side\.open\{[^}]*font-size:var\(--tvM-body\)/);
  // No thin type on the HUD, and a solid plate behind it.
  const plate = component.match(/\n\.tvSlot\{[^}]*background:rgba\(\d+,\d+,\d+,(\.\d+)\)/);
  assert.ok(plate && Number(plate[1]) >= 0.75, 'HUD slots sit on a near-opaque plate');
  assert.doesNotMatch(component.match(/\/\* HUD type is TV\.hudType[\s\S]*?\.tvCard\{/)[0], /font-weight:[1-5]00/);
});

test('important states do not rely on colour alone', () => {
  assert.match(component, /\.root\.tvMode \.btn:focus::before\{content:/, 'focused buttons get a marker');
  assert.match(component, /\.root\.tvMode \.seg button\.on::before\{content:/, 'selected choices get a check');
  assert.match(component, /\.tvWarn::before,\.tvAlarm::before\{content:/, 'warnings get a symbol');
  assert.match(component, /\.tvAlarm\{[^}]*background:/, 'alarms get a plate');
  assert.match(component, /\.screenFit\[data-edge=top\] \.sfFrame\{border-top:10px/, 'the edge being moved is thicker');
  assert.match(component, /s\.textContent = \(sel \? '(\u25b6|\\u25b6) ' : ''\)/, 'and its label is marked');
  assert.match(component, /<b class="tvKey k\$\{k\}">\$\{k\}<\/b>/, 'controller prompts spell the button');
});

test('spatial focus walks rows sideways, steps between rows and wraps vertically', () => {
  // A title button, a three-way segment row, and two stacked buttons.
  const R = [
    { x: 0, y: 0, w: 300, h: 40 },     // 0 wide button
    { x: 0, y: 60, w: 90, h: 40 },     // 1 seg left
    { x: 100, y: 60, w: 90, h: 40 },   // 2 seg mid
    { x: 200, y: 60, w: 90, h: 40 },   // 3 seg right
    { x: 0, y: 120, w: 300, h: 40 },   // 4 wide button
    { x: 0, y: 180, w: 300, h: 40 },   // 5 wide button
  ];
  assert.equal(spatialPick(R, 1, 1, 0), 2);
  assert.equal(spatialPick(R, 2, 1, 0), 3);
  assert.equal(spatialPick(R, 3, 1, 0), -1, 'right stops at the row end');
  assert.equal(spatialPick(R, 3, -1, 0), 2);
  assert.equal(spatialPick(R, 0, 0, 1), 2, 'down lands on the nearest control below');
  assert.equal(spatialPick(R, 3, 0, 1), 4);
  assert.equal(spatialPick(R, 4, 0, -1), 2);
  assert.equal(spatialPick(R, 5, 0, 1), 0, 'down from the bottom wraps to the top');
  assert.equal(spatialPick(R, 0, 0, -1), 5, 'up from the top wraps to the bottom');
  assert.equal(spatialPick(R, -1, 0, 1), 0);
  assert.equal(spatialPick([], -1, 0, 1), -1);
});

test('every screen has a default selection and B / Escape always mean back', () => {
  assert.match(component, /class="btn ghost localPlay" data-tv-default/);
  assert.match(component, /menuDefault\(root, list = this\.menuFocusables\(root\)\) \{[\s\S]{0,120}data-tv-default/);
  assert.match(component, /this\.syncMenuFocus\(\);/);
  assert.match(component, /if \(menu && k === 'escape'\) \{ this\.menuBack\(\);/);
  const C = loadComponent(), P = C.prototype;
  const els = ['screenFitEl', 'sideEl', 'pauseEl', 'tutEl', 'lobbyEl', 'reconnectEl', 'homeEl', 'endEl', 'levelUpEl'];
  const g = Object.create(P); for (const k of els) g[k] = { name: k };
  assert.equal(g.menuBackLabel(g.screenFitEl), 'Cancel');
  assert.equal(g.menuBackLabel(g.sideEl), 'Close');
  assert.equal(g.menuBackLabel(g.pauseEl), 'Resume');
  g._tutBack = 'home'; assert.equal(g.menuBackLabel(g.tutEl), 'Back');
  assert.equal(g.menuBackLabel(g.lobbyEl), 'Leave…');
  for (const k of ['homeEl', 'endEl', 'levelUpEl']) assert.equal(g.menuBackLabel(g[k]), null, `${k} has nothing behind it`);
  // Back from the tutorial you reached from the home card goes home.
  let calls = [];
  Object.assign(g, { menuRoot: () => g.tutEl, online: false, state: 'tutorial',
    tutEl: { style: { display: 'grid' } }, homeEl: { style: { display: 'none' } } });
  g.menuRoot = () => g.tutEl; g.menuBack();
  assert.equal(g.tutEl.style.display, 'none'); assert.equal(g.homeEl.style.display, 'grid'); assert.equal(g.state, 'home');
  // Back in a lobby only moves focus to Leave; it never abandons the room by itself.
  Object.assign(g, { menuRoot: () => g.lobbyEl, leaveOnline: () => calls.push('leave'), menuFocus: el => calls.push(el),
    shadowRoot: { querySelector: q => q } });
  g.menuBack();
  assert.deepEqual(calls, ['.lobbyLeave']);
});

test('arcade character entry lets a controller type a room code or initials', () => {
  const C = loadComponent(), g = Object.create(C.prototype);
  const el = { value: '', maxLength: 3, dataset: { padChars: 'ABC' }, dispatchEvent() {} };
  assert.equal(g.padCharInput(el, 'v', 1), true); assert.equal(el.value, 'A');
  g.padCharInput(el, 'v', -1); assert.equal(el.value, 'C', 'wraps backwards');
  g.padCharInput(el, 'h', 1); g.padCharInput(el, 'v', 1); assert.equal(el.value, 'CB');
  g.padCharInput(el, 'h', 1); assert.equal(el.value, 'CBA');
  assert.equal(g.padCharInput(el, 'h', 1), false, 'full: right hands back to spatial focus');
  g.padCharInput(el, 'h', -1); assert.equal(el.value, 'CB');
  el.value = ''; assert.equal(g.padCharInput(el, 'h', -1), false, 'empty: left hands back too');
  assert.match(component, /class="hsIn"[^>]*data-pad-chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"/);
  assert.match(component, /class="textInput roomInput"[^>]*data-pad-chars="0123456789"/);
});

test('controllers keep their slot, and a disconnect releases holds and pauses local play', () => {
  const pad = (index, pressed = []) => ({ index, connected: true, axes: [0, 0],
    buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })) });
  let pads = [pad(0), pad(1)];
  const C = loadComponent({ navigator: { getGamepads: () => pads } }), P = C.prototype;
  const toasts = [], fired = [];
  let paused = 0;
  const players = [0, 1, 2].map(i => ({ i, bot: i === 2, held: { l: false, r: false }, name: 'P' + (i + 1) }));
  const g = Object.assign(Object.create(P), {
    settings: { displayMode: 'tv', mode: 'clear' }, players, state: 'play', online: false,
    menuRoot: () => null, padToast: t => toasts.push(t), fire: i => fired.push(i),
    togglePause() { paused++; this.state = 'paused'; }, shadowRoot: { querySelector: () => ({ textContent: '' }) },
  });
  g.pollGamepads();
  assert.deepEqual([...g._padSlots.values()], [0, 1]);
  assert.deepEqual(toasts, ['Controller 1 connected · P1', 'Controller 2 connected · P2']);
  // Pad 2 holds right, then pad 1 drops out: pad 2 keeps driving P2.
  pads = [pad(0), Object.assign(pad(1), { axes: [1, 0] })];
  g.pollGamepads();
  assert.equal(players[1].held.r, true);
  pads = [Object.assign(pad(1), { axes: [1, 0] })];
  g.pollGamepads();
  assert.equal(g._padSlots.get(1), 1, 'slot kept across the other pad leaving');
  assert.equal(paused, 1, 'local play pauses when a driving pad drops');
  assert.match(toasts.at(-1), /Controller 1 disconnected/);
  // Now pad 2 drops while holding: its launcher must not keep turning.
  g.state = 'play';
  pads = [];
  g.pollGamepads();
  assert.deepEqual({ ...players[1].held }, { l: false, r: false });
  assert.equal(paused, 2);
  // Reconnecting while A is held is not a shot; releasing and pressing again is.
  pads = [pad(1, [0])];
  g.pollGamepads();
  assert.equal(g._padSlots.get(1), 0, 'a reconnecting pad takes the lowest free slot');
  assert.deepEqual(fired, []);
  pads = [pad(1)]; g.pollGamepads();
  pads = [pad(1, [0])]; g.pollGamepads();
  assert.deepEqual(fired, [0]);
});

test('geometry lock: TV↔Desktop flip mid-match never moves H, danger line or resets offline play', () => {
  const C = loadComponent();
  const root = {
    clientWidth: 1920, clientHeight: 1080,
    style: { setProperty() {} },
    classList: { toggle() {}, remove() {}, contains: () => false },
  };
  const col = { style: {} };
  const canvas = { style: {}, clientWidth: 640 };
  let resetCalls = 0;
  const g = Object.assign(Object.create(C.prototype), {
    rootEl: root, gameColEl: col, canvas,
    settings: { displayMode: 'auto', mode: 'clear', field: 'classic', level: 0, players: 2 },
    online: false, state: 'play', score: 1234, dispScore: 1234, H: 1080, LAUNCH_Y: 1000, DANGER_Y: 800,
    connectedPads: () => [{}], tvActive: true, fit() {},
    resetGame() { resetCalls++; },
  });
  assert.equal(g.H, 1080);
  const initialLaunchY = g.LAUNCH_Y, initialDangerY = g.DANGER_Y;

  // Mid-match flip: window resizes to 21:9 with no pad -> resolves to desktop
  root.clientWidth = 3440; root.clientHeight = 1440;
  g.connectedPads = () => [];
  g.measure();
  assert.equal(g.tvActive, false, 'flipped to desktop');
  assert.equal(g.H, 1080, 'H is locked and unchanged');
  assert.equal(g.LAUNCH_Y, initialLaunchY, 'LAUNCH_Y unchanged');
  assert.equal(g.DANGER_Y, initialDangerY, 'DANGER_Y unchanged');
  assert.equal(g.score, 1234, 'score untouched');
  assert.equal(resetCalls, 0, 'never calls resetGame');

  // Tall viewport while still in match: H stays locked, new deviceViewH stashed
  root.clientWidth = 500; root.clientHeight = 1000;
  g.measure();
  assert.equal(g.H, 1080, 'H stays locked');
  assert.equal(g._deviceViewH, 1280, 'stashed tall deviceViewH');

  // Next resetGame without carry adopts stashed _deviceViewH
  g.resetGame = C.prototype.resetGame;
  g.players = [{ x: 320 }]; g.activeP = 0; g.levelRows = () => []; g.levelColors = () => []; g.spawnPlayers = () => { g.players = [{ x: 320 }]; }; g.updateLowest = () => {}; g.hideOverlays = () => {};
  g.resetGame();
  assert.equal(g.H, 1280, 'adopts stashed view height at next resetGame');
});

test('size-only relayoutTv does not call placeTvHud', () => {
  const C = loadComponent();
  const root = { clientWidth: 1920, clientHeight: 1080, style: { setProperty() {} }, classList: { toggle() {}, remove() {}, contains: () => false } };
  const col = { style: {} };
  const canvas = { style: {}, clientWidth: 640 };
  let placed = 0;
  const g = Object.assign(Object.create(C.prototype), {
    rootEl: root, gameColEl: col, canvas,
    settings: { displayMode: 'tv', mode: 'clear', players: 2 },
    tvActive: true, H: 1080, fit() {},
    placeTvHud(lay) { placed++; },
  });
  g.relayoutTv();
  assert.equal(placed, 1, 'initial layout calls placeTvHud');

  // Size change only:
  root.clientWidth = 2560; root.clientHeight = 1440;
  g.relayoutTv();
  assert.equal(placed, 1, 'size change does not rebuild HUD DOM');

  // Screen Fit change triggers rebuild:
  g._fitDraft = { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 };
  g.relayoutTv();
  assert.equal(placed, 2, 'fit change rebuilds HUD DOM');
});

test('forced TV below 960x540 pauses offline play without reset, locks pause against Start/P, and never pauses online', () => {
  const C = loadComponent();
  const classes = new Set();
  const root = {
    clientWidth: 800, clientHeight: 450,
    style: { setProperty() {} },
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      toggle: (c, v) => (v ?? !classes.has(c)) ? classes.add(c) : classes.delete(c),
      contains: c => classes.has(c),
    },
  };
  const col = { style: {} };
  const canvas = { style: {}, clientWidth: 400 };
  let closedFit = 0;
  const pauseEl = { style: {}, querySelectorAll: () => [] };
  const tvSmallEl = { style: {}, querySelectorAll: () => [] };
  const sideEl = { classList: { contains: () => false } };
  const shadowRoot = { querySelector: () => ({ textContent: '' }) };
  const g = Object.assign(Object.create(C.prototype), {
    rootEl: root, gameColEl: col, canvas, pauseEl, tvSmallEl, sideEl, shadowRoot,
    settings: { displayMode: 'tv', mode: 'clear', players: 2 },
    tvActive: true, H: 1080, state: 'play', online: false, fit() {},
    syncButtons() {},
    connectedPads() { return []; },
    closeScreenFit(save) { closedFit++; },
  });

  // Enter too-small state
  g.tvApplyStage();
  assert.equal(g._tvTooSmall, true);
  assert.equal(root.classList.contains('tvTooSmall'), true);
  assert.equal(g.state, 'paused', 'offline play paused on entry to too-small');
  assert.equal(closedFit, 1, 'screen fit cancelled on entry to too-small');

  // Verify padStart, togglePause, and menuBack cannot resume while notice is active
  g.padStart();
  assert.equal(g.state, 'paused', 'padStart does not unpause while too-small notice is active');

  g.togglePause();
  assert.equal(g.state, 'paused', 'togglePause does not unpause while too-small notice is active');

  g.menuBack();
  assert.equal(g.state, 'paused', 'menuBack does not unpause while too-small notice is active');

  // Growing back hides notice and leaves game paused (no auto-resume)
  root.clientWidth = 1920; root.clientHeight = 1080;
  g.tvApplyStage();
  assert.equal(g._tvTooSmall, false);
  assert.equal(root.classList.contains('tvTooSmall'), false);
  assert.equal(g.state, 'paused', 'game remains paused after window grows back');

  // After restoring above minimum, player can resume with padStart
  g.padStart();
  assert.equal(g.state, 'play', 'padStart resumes play once restored above minimum');

  // Mode round trip: drop below minimum, choose Desktop layout, resume, and switch back to TV
  root.clientWidth = 800; root.clientHeight = 450;
  g.tvApplyStage();
  assert.equal(g._tvTooSmall, true);
  assert.equal(root.classList.contains('tvTooSmall'), true);
  assert.equal(g.state, 'paused', 'offline play paused on shrinking below minimum');

  // Choose Use Desktop layout
  g.settings.displayMode = 'desktop';
  g.syncDisplayMode();
  assert.equal(g.tvActive, false, 'leaving TV sets tvActive to false');
  assert.equal(g._tvTooSmall, false, 'leaving TV clears _tvTooSmall');
  assert.equal(root.classList.contains('tvTooSmall'), false, 'leaving TV clears tvTooSmall class');

  // Resume offline match while in desktop mode
  g.togglePause();
  assert.equal(g.state, 'play', 'offline play resumed while in desktop layout');

  // Switch back to TV at the same small size (< 960x540)
  g.settings.displayMode = 'tv';
  g.syncDisplayMode();
  assert.equal(g.tvActive, true, 're-entering TV sets tvActive to true');
  g.tvApplyStage();
  assert.equal(g._tvTooSmall, true, 're-entering TV below minimum sets _tvTooSmall');
  assert.equal(root.classList.contains('tvTooSmall'), true, 'tvTooSmall class reapplied');
  assert.equal(g.state, 'paused', 'offline play paused again on switching back to TV below minimum');

  // Online match does not pause
  let onlinePaused = 0;
  const gOnline = Object.assign(Object.create(C.prototype), {
    rootEl: root, gameColEl: col, canvas,
    settings: { displayMode: 'tv', mode: 'clear', players: 2 },
    tvActive: true, H: 1080, state: 'play', online: true, fit() {},
    togglePause() { onlinePaused++; },
    closeScreenFit(save) {},
  });
  root.clientWidth = 800; root.clientHeight = 450;
  gOnline.tvApplyStage();
  assert.equal(gOnline.state, 'play', 'online play is never paused by too-small');
  assert.equal(onlinePaused, 0);
});

test('changing devicePixelRatio re-fits canvas backing store and cleans up on disconnect', () => {
  const queryMap = new Map();
  const createMq = q => {
    let handler = null;
    const mq = {
      media: q,
      addEventListener(evt, fn) { if (evt === 'change') handler = fn; },
      removeEventListener(evt, fn) { if (evt === 'change' && handler === fn) handler = null; },
      fire() { handler && handler(); },
      hasHandler: () => handler !== null,
    };
    queryMap.set(q, mq);
    return mq;
  };

  let curDpr = 1;
  const C = loadComponent({
    matchMedia: q => createMq(q),
    getDpr: () => curDpr,
  });

  let fitCalls = 0;
  const g = Object.assign(Object.create(C.prototype), {
    fit() { fitCalls++; },
  });

  // Call the component's actual setupDprListener() method
  g.setupDprListener();

  // Initial listener is registered on (resolution: 1dppx)
  assert.equal(queryMap.get('(resolution: 1dppx)')?.hasHandler(), true, 'registered listener on initial resolution');
  assert.equal(fitCalls, 0);

  // Pixel ratio changes to 2 (e.g. window moved to 2x display)
  curDpr = 2;
  queryMap.get('(resolution: 1dppx)').fire();
  assert.equal(fitCalls, 1, 'component.fit() called by component listener on DPR change');
  assert.equal(queryMap.get('(resolution: 1dppx)')?.hasHandler(), false, 'old listener unhooked when re-arming');
  assert.equal(queryMap.get('(resolution: 2dppx)')?.hasHandler(), true, 're-armed listener on new resolution');

  // Trigger again on new resolution
  queryMap.get('(resolution: 2dppx)').fire();
  assert.equal(fitCalls, 2, 'second DPR change calls fit again');

  // Calling component's disconnectedCallback removes listener
  g.disconnectedCallback();
  assert.equal(queryMap.get('(resolution: 2dppx)')?.hasHandler(), false, 'listener removed on disconnect');

  // Firing after disconnect does nothing
  queryMap.get('(resolution: 2dppx)').fire();
  assert.equal(fitCalls, 2, 'no further fit calls after disconnect');
});
