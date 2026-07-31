'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('online battle carries previews forward without rewinding cached shots', () => {
  assert.match(component,/freshPreviews\.get\(summary\.id\)\|\|\(old\.id\?null:/);
  assert.match(component,/for\(const b of bt\.boards\)/);
  assert.match(component,/stepOnlineFlights\(this\.flights,dt,X0\+R,W-X0-R\)/);
});

test('online falling bubbles expire instead of becoming shoot-through ghosts', () => {
  const src=component.match(/^const stepOnlineFalling = [\s\S]*?^};$/m);assert.ok(src);
  const step=vm.runInNewContext(`${src[0]} stepOnlineFalling`),falling=[{x:10,y:90,vx:0,vy:100,a:0,spin:0}];
  for(let i=0;i<120;i++)step(falling,1/60,100);
  assert.equal(falling.length,0);
});

test('an incomplete launcher snapshot cannot abort cannon rendering', () => {
  assert.match(component,/if \(cur\) this\.drawBubble/);
  assert.match(component,/if \(next\) \{/);
  assert.match(component,/wirePlayer\|\|wasPlayer\|\|\{x:W\/2,angle:0,cur:null/);
});
