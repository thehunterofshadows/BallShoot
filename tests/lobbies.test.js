'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rooms = require('../server/lobbies');

const socket = () => ({readyState:1,messages:[],send(value){this.messages.push(JSON.parse(value));}});
test.afterEach(()=>rooms.clear());

test('creates a three digit room and locks it after a two-player start', () => {
  const host=rooms.create('Host',socket(),'one'), guest=rooms.join(host.room.code,'Guest',socket(),'two');
  assert.match(host.room.code,/^\d{3}$/);rooms.start(host.room,host.p);assert.equal(host.room.phase,'playing');
  assert.throws(()=>rooms.join(host.room.code,'Late',socket(),'three'),e=>e.code==='match_started');
  assert.equal(host.room.game.players[1].id,guest.p.id);
});

test('only the host may change validated lobby settings', () => {
  const host=rooms.create('Host',socket(),'one'), guest=rooms.join(host.room.code,'Guest',socket(),'two');
  const next={...host.room.settings,field:'wide',guide:.25,sound:false};
  assert.throws(()=>rooms.updateSettings(host.room,guest.p,next,0),e=>e.code==='not_host');
  rooms.updateSettings(host.room,host.p,next,0);
  assert.equal(host.room.settings.field,'wide');assert.equal(host.room.revision,1);
  assert.throws(()=>rooms.updateSettings(host.room,host.p,next,0),e=>e.code==='stale_revision');
});

test('the host sets the control feel for the whole room', () => {
  // Touch tint and FIRE size are device preferences locally, but inside a room they are the
  // host's call like every other rule, so they have to survive validation and reach clients.
  const host=rooms.create('Host',socket(),'one');
  rooms.updateSettings(host.room,host.p,{...host.room.settings,padTint:.2,fireScale:1.8,aimSpeed:5},0);
  assert.equal(host.room.settings.padTint,.2);
  assert.equal(host.room.settings.fireScale,1.8);
  assert.equal(rooms.publicRoom(host.room).settings.fireScale,1.8);
  for(const bad of [{padTint:.9},{padTint:-1},{fireScale:3},{fireScale:.1},{fireScale:'big'}])
    assert.throws(()=>rooms.updateSettings(host.room,host.p,{...host.room.settings,...bad},1),e=>e.code==='bad_settings');
  // A client that predates the settings gets the shipped defaults rather than a rejection.
  const legacy={...host.room.settings};delete legacy.padTint;delete legacy.fireScale;
  rooms.updateSettings(host.room,host.p,legacy,1);
  assert.equal(host.room.settings.padTint,rooms.DEFAULT_SETTINGS.padTint);
  assert.equal(host.room.settings.fireScale,rooms.DEFAULT_SETTINGS.fireScale);
});

test('reconnect tokens reclaim seats and explicit host leave transfers authority', () => {
  const host=rooms.create('Host',socket(),'one'), guest=rooms.join(host.room.code,'Guest',socket(),'two');
  rooms.disconnect(host.room,host.p,false);const replacement=socket();const result=rooms.rejoin(host.room.code,host.p.token,replacement);
  assert.equal(result.p.id,host.p.id);assert.equal(result.p.connected,true);
  rooms.disconnect(host.room,host.p,true);assert.equal(host.room.hostId,guest.p.id);
});

test('room capacity is four and duplicate names are rejected', () => {
  const host=rooms.create('Host',socket(),'one');rooms.join(host.room.code,'Two',socket(),'two');rooms.join(host.room.code,'Three',socket(),'three');rooms.join(host.room.code,'Four',socket(),'four');
  assert.throws(()=>rooms.join(host.room.code,'Five',socket(),'five'),e=>e.code==='room_full');
  const other=rooms.create('Ada',socket(),'six');assert.throws(()=>rooms.join(other.room.code,'ada',socket(),'seven'),e=>e.code==='name_taken');
});

test('battle rooms allow eight players and cannot switch oversized rooms back to co-op', () => {
  const host=rooms.create('One',socket(),'one');
  rooms.updateSettings(host.room,host.p,{...host.room.settings,mode:'battle',field:'wide'},0);
  assert.equal(host.room.settings.field,'classic');
  for(let i=2;i<=8;i++)rooms.join(host.room.code,String(i),socket(),String(i));
  assert.equal(host.room.players.length,8);
  assert.throws(()=>rooms.join(host.room.code,'Nine',socket(),'nine'),e=>e.code==='room_full');
  assert.throws(()=>rooms.updateSettings(host.room,host.p,{...host.room.settings,mode:'clear'},1),e=>e.code==='too_many_players');
});

test('unexpected battle disconnects idle but explicit leaves forfeit', () => {
  const host=rooms.create('Host',socket(),'one'),guest=rooms.join(host.room.code,'Guest',socket(),'two');
  rooms.updateSettings(host.room,host.p,{...host.room.settings,mode:'battle'},0);rooms.start(host.room,host.p);
  rooms.disconnect(host.room,guest.p,false);assert.equal(host.room.game.board(guest.p.id).alive,true);
  rooms.rejoin(host.room.code,guest.p.token,socket());assert.equal(host.room.game.board(guest.p.id).connected,true);
  rooms.disconnect(host.room,guest.p,true);assert.equal(host.room.game.board(guest.p.id).alive,false);
  rooms.tick(1/60);assert.equal(host.room.phase,'ended');
});
