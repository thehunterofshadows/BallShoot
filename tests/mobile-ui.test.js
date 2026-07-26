'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const component = fs.readFileSync(path.join(root, 'coop-bubbles.js'), 'utf8');
const documentShell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('mobile layout uses the dynamic viewport and safe-area insets', () => {
  assert.match(documentShell, /viewport-fit=cover/);
  assert.match(documentShell, /100dvh/);
  assert.match(component, /aspect-ratio:var\(--fieldAspect/);
  assert.match(component, /safe-area-inset-bottom/);
});

test('the board aspect ratio follows the adaptive world height, not a fixed constant', () => {
  // The old layout hardcoded 640/1080 in CSS and recomputed it from viewport units in
  // three places. relayout() is now the only writer.
  assert.doesNotMatch(component, /aspect-ratio:640\/1080/);
  assert.doesNotMatch(component, /640 \/ 1080/);
  assert.match(component, /setProperty\('--fieldAspect'/);
});

test('the resize pass separates the available box from the board it sizes', () => {
  // Measuring .gameCol to decide .gameCol's size would let the observer feed itself.
  assert.match(component, /_availObserver[\s\S]{0,120}observe\(this\.rootEl\)/);
  assert.match(component, /_resizeObserver[\s\S]{0,120}observe\(this\.gameColEl\)/);
  assert.match(component, /orientationchange/);
  assert.match(component, /visualViewport/);
  assert.match(component, /this\._availObserver && this\._availObserver\.disconnect\(\)/);
  assert.match(component, /this\._viewportUnbind && this\._viewportUnbind\(\)/);
});

test('leftover width beside the board is spent on UI rather than a viewport breakpoint', () => {
  assert.doesNotMatch(component, /@media \(max-width:900px\)/);
  assert.match(component, /classList\.toggle\('wideLayout'/);
  assert.match(component, /\.root:not\(\.wideLayout\) \.side\{display:none\}/);
});

test('mobile touch controls scale with the board and use a subtle pressed tint', () => {
  assert.match(component, /\.pad \.padF\{[^}]*bottom:calc\(18px \* var\(--u,1\)\)/);
  // The tint strength is a --padTint setting, defaulting to the old subtle 2.5%.
  assert.match(component, /\.pad \.padL:active,.pad \.padR:active\{background:rgba\(43,111,212,var\(--padTint,\.025\)\)/);
  assert.match(component, /padTint:0\.025/);
  assert.match(component, /setProperty\('--padTint'/);
  // "Off" must be genuinely invisible: no arrow-ink change, and no UA tap highlight
  // painting its own wash over ours.
  assert.match(component, /-webkit-tap-highlight-color:transparent/);
  assert.match(component, /:active[^}]*color:var\(--padInk,#2b6fd4\)/);
  assert.match(component, /setProperty\('--padInk'/);
});

test('the FIRE button scales as a whole and pushes the swap button clear', () => {
  assert.match(component, /\.pad \.padF\{[^}]*padding:calc\(12px \* var\(--u,1\) \* var\(--fireScale,1\)\)/);
  assert.match(component, /\.pad \.padF\{[^}]*font-size:calc\(clamp\(11px,calc\(14px \* var\(--u,1\)\),19px\) \* var\(--fireScale,1\)\)/);
  assert.match(component, /\.pad \.padS\{[^}]*translateX\(calc\(-50% \+ 92px \* var\(--u,1\) \* var\(--fireScale,1\)\)\)/);
  assert.match(component, /fireScale:1/);
  assert.match(component, /setProperty\('--fireScale'/);
  // The aim zones stay in the bottom half of the board at every board shape, so the
  // upper half is free for reading the field rather than swallowing aim drags.
  assert.match(component, /\.pad\{[^}]*height:50%/);
  assert.doesNotMatch(component, /\.root\.wideLayout \.pad\{height:100%\}/);
});

test('FIRE outranks the aim halves, and a near miss still fires', () => {
  // The halves are transparent full-height overlays, so leaving this to CSS stacking meant a
  // thumb a few pixels off FIRE turned the launcher instead of shooting. One router decides.
  const order = component.match(/padHit\(x, y\) \{[\s\S]*?\n  \}/);
  assert.ok(order, 'padHit not found');
  const picks = [...order[0].matchAll(/return '(\w+)'/g)].map(m => m[1]);
  assert.deepEqual(picks, ['swap','fire','fire','swap','aim','l','r'],
    'exact hits first, keeping swap; then near misses, where FIRE outranks everything');
  // Slop grows with the button and only exists where the overlays do.
  assert.match(component, /padSlop\(\) \{[\s\S]*?pointer: coarse[\s\S]*?22 \* u \* \(this\.settings\.fireScale \|\| 1\)/);
  // A single capture-phase listener owns the pad; the per-button pointerdown wiring is gone.
  assert.match(component, /pad\.addEventListener\('pointerdown', e => \{[\s\S]{0,200}this\.padHit\(e\.clientX, e\.clientY\)/);
  assert.doesNotMatch(component, /wireHold\('\.padL', 'l'\)/);
});

test('point-to-aim is a per-device control scheme, never a room setting', () => {
  assert.match(component, /const AIM_MODES = \['halves', 'point'\]/);
  assert.match(component, /\.root\[data-aim-mode="point"\] \.pad\{top:0;height:100%\}/);
  assert.match(component, /\.root\[data-aim-mode="point"\] \.pad \.padL,[^{]*\.padR\{display:none\}/);
  assert.match(component, /AIM_MODES\.includes\(p\.aimMode\)/);       // clamped on load like the sliders
  assert.match(component, /JSON\.stringify\(\{ aimSpeed, padTint, fireScale, aimMode \}\)/);
  // It must not travel with the room: the server has no such setting to merge over it.
  const lobbies = fs.readFileSync(path.join(root, 'server', 'lobbies.js'), 'utf8');
  assert.doesNotMatch(lobbies, /aimMode/);
  assert.doesNotMatch(component, /data-setting="aimMode"/);
});

test('the host publishes one set of controls to the whole room', () => {
  assert.match(component, /<label>Touch tint<input data-setting="padTint"/);
  assert.match(component, /<label>FIRE size<input data-setting="fireScale"/);
  // Range inputs ship strings, which validateSettings rejects.
  assert.match(component, /'guide','aimSpeed','padTint','fireScale'\]\.includes\(el\.dataset\.setting\)\)v=Number\(v\)/);
  // Arriving settings have to reach the CSS variables, and leaving hands the device's own back.
  assert.match(component, /applyRoomControls\(\)\{this\.applyTouchStyle\(\)/);
  assert.match(component, /restoreLocalPrefs\(\)\{Object\.assign\(this\.settings,\{aimSpeed:2\.4,padTint:0\.025,fireScale:1\}/);
});

test('overlay chrome is sized in board units so it stays tappable at any board size', () => {
  assert.match(component, /setProperty\('--u'/);
  assert.match(component, /--chromeBtn:clamp\(36px,calc\(44px \* var\(--u,1\)\),56px\)/);
  // The old 62px onlineBar inset was a hand-tuned copy of the corner button geometry.
  assert.doesNotMatch(component, /\.onlineBar\{[^}]*left:62px/);
});

test('fullscreen control supports entry, exit, and lifecycle cleanup', () => {
  assert.match(component, /class="cornerButton fullscreenButton"/);
  assert.match(component, /this\.requestFullscreen \|\| this\.webkitRequestFullscreen/);
  assert.match(component, /document\.exitFullscreen \|\| document\.webkitExitFullscreen/);
  assert.match(component, /this\._fullscreenUnbind && this\._fullscreenUnbind\(\)/);
});
