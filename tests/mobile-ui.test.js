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
  assert.match(component, /\.pad \.padL:active,.pad \.padR:active\{background:rgba\(43,111,212,.05\)/);
  // A short board leaves too little height for bottom-half aim zones.
  assert.match(component, /\.root\.wideLayout \.pad\{height:100%\}/);
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
