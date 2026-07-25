'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const component = fs.readFileSync(path.resolve(__dirname,'..','coop-bubbles.js'),'utf8');

test('battle mode exposes two through eight players and mode-specific help', () => {
  assert.match(component,/data-m="battle"/);
  for(let n=2;n<=8;n++)assert.match(component,new RegExp(`data-n="${n}"`));
  assert.match(component,/CHOOSE YOUR TARGET!/);
  assert.match(component,/Last one floating!/);
});

test('shot pressure is tunable from both settings surfaces and shown on the HUD', () => {
  assert.match(component,/data-setting="pressureShots"/);       // online lobby
  assert.match(component,/class="sp" min="0" max="20"/);         // local tuning panel
  assert.match(component,/ROW PUSH IN /);                        // co-op HUD countdown
  assert.match(component,/pressureShots:8/);                     // on by default
});

test('online battle snapshots and target choices use the authoritative protocol', () => {
  assert.match(component,/s\.kind==='battle'/);
  assert.match(component,/applyOnlineBattleSnapshot/);
  assert.match(component,/sendOnline\('target',\{targetId:board\.id\}\)/);
  assert.match(component,/pendingTarget/);
  assert.match(component,/state==='spectating'/);
});
