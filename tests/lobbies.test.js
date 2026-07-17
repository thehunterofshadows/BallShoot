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
