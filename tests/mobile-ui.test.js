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
  assert.match(component, /aspect-ratio:640\/1080/);
  assert.match(component, /safe-area-inset-bottom/);
});

test('mobile touch controls keep fire low and use a subtle pressed tint', () => {
  assert.match(component, /\.pad \.padF\{[^}]*bottom:18px/);
  assert.match(component, /\.pad \.padL:active,.pad \.padR:active\{background:rgba\(43,111,212,.05\)/);
});

test('fullscreen control supports entry, exit, and lifecycle cleanup', () => {
  assert.match(component, /class="cornerButton fullscreenButton"/);
  assert.match(component, /this\.requestFullscreen \|\| this\.webkitRequestFullscreen/);
  assert.match(component, /document\.exitFullscreen \|\| document\.webkitExitFullscreen/);
  assert.match(component, /this\._fullscreenUnbind && this\._fullscreenUnbind\(\)/);
});
