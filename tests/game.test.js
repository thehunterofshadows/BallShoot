'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OnlineGame } = require('../server/game');
const { DEFAULT_SETTINGS } = require('../server/lobbies');

const roster = [{id:'a',name:'Ada'},{id:'b',name:'Ben'}];

test('seeded games produce identical authoritative state', () => {
  const a=new OnlineGame(DEFAULT_SETTINGS,roster,12345), b=new OnlineGame(DEFAULT_SETTINGS,roster,12345);
  a.input('a',{r:true});b.input('a',{r:true});
  for(let i=0;i<30;i++){a.update(1/60);b.update(1/60);}
  a.fire('a');b.fire('a');
  for(let i=0;i<180;i++){a.update(1/60);b.update(1/60);}
  assert.deepEqual(a.snapshot(),b.snapshot());
});

test('wide fields and settings are represented in snapshots', () => {
  const game=new OnlineGame({...DEFAULT_SETTINGS,field:'wide',guide:.25,sound:false},roster,7);
  const snapshot=game.snapshot();
  assert.equal(snapshot.WW,2560);
  assert.equal(snapshot.players.length,2);
  assert.equal(snapshot.settings.guide,.25);
  assert.equal(snapshot.settings.sound,false);
  assert.ok(snapshot.grid.length>40);
});

test('disconnected launchers become idle and cannot fire', () => {
  const game=new OnlineGame(DEFAULT_SETTINGS,roster,8);
  game.input('a',{l:true});game.update(1/60);const angle=game.players[0].angle;
  game.setConnected('a',false);
  assert.equal(game.fire('a'),false);
  for(let i=0;i<20;i++)game.update(1/60);
  assert.equal(game.players[0].angle,angle);
});
