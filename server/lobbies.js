'use strict';

const crypto = require('node:crypto');
const { OnlineGame } = require('./game');
const { BattleGame } = require('./battle');

const DEFAULT_SETTINGS = Object.freeze({
  reload:1.35, missMax:12, rescueDur:4, assist:.35, mateLines:true, sound:true,
  mode:'clear', field:'classic', guide:1, level:0, customText:'',
});
const rooms = new Map();
const limits = new Map();
const fail = (code, message) => Object.assign(new Error(message), { code });
const cleanName = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 16);

function validateSettings(input) {
  const s = { ...DEFAULT_SETTINGS, ...(input || {}) };
  if (!['clear','endless','battle'].includes(s.mode)) throw fail('bad_settings','Invalid game mode.');
  if (!['classic','wide'].includes(s.field)) throw fail('bad_settings','Invalid field width.');
  if (!(s.level === 'custom' || Number.isInteger(s.level) && s.level >= 0 && s.level <= 3)) throw fail('bad_settings','Invalid level.');
  const number = (name,min,max) => { s[name]=Number(s[name]); if(!Number.isFinite(s[name])||s[name]<min||s[name]>max)throw fail('bad_settings',`Invalid ${name}.`); };
  number('reload',.8,2.2); number('missMax',4,20); number('rescueDur',3,5); number('assist',0,1);
  if (![.25,.5,1].includes(Number(s.guide))) throw fail('bad_settings','Invalid guide length.');
  s.guide=Number(s.guide); s.mateLines=!!s.mateLines; s.sound=!!s.sound;
  s.customText=String(s.customText || '').slice(0, 512);
  return s;
}
function rateLimit(address, kind, max, windowMs) {
  const k=`${address}:${kind}`, now=Date.now(), old=limits.get(k) || [];
  const hits=old.filter(t=>now-t<windowMs); if(hits.length>=max)throw fail('rate_limited','Too many attempts. Try again shortly.');
  hits.push(now); limits.set(k,hits);
}
function allocateCode() {
  if (rooms.size >= 1000) throw fail('rooms_full','No room codes are currently available.');
  for(let i=0;i<2000;i++){const code=String(crypto.randomInt(0,1000)).padStart(3,'0');if(!rooms.has(code))return code;}
  for(let i=0;i<1000;i++){const code=String(i).padStart(3,'0');if(!rooms.has(code))return code;}
}
function player(name, ws) { return { id:crypto.randomUUID(), token:crypto.randomBytes(24).toString('base64url'), name, ws, connected:true, joinedAt:Date.now(), disconnectedAt:null, hostTimer:null, inputSeq:-1 }; }
function publicRoom(room) { return { code:room.code, phase:room.phase, hostId:room.hostId, revision:room.revision, settings:room.settings,
  players:room.players.map((p,i)=>({id:p.id,name:p.name,connected:p.connected,seat:i})) }; }
function broadcast(room, type, payload={}) { const body=JSON.stringify({type,...payload}); for(const p of room.players)if(p.connected&&p.ws?.readyState===1)p.ws.send(body); }

function create(name, ws, address='unknown') {
  rateLimit(address,'create',10,60_000); name=cleanName(name); if(!name)throw fail('bad_name','Enter a display name.');
  const p=player(name,ws), code=allocateCode();
  const room={code,phase:'lobby',hostId:p.id,revision:0,settings:{...DEFAULT_SETTINGS},players:[p],game:null,createdAt:Date.now(),emptyAt:null};
  rooms.set(code,room); return {room,p};
}
function join(code, name, ws, address='unknown') {
  rateLimit(address,'join',30,60_000); code=String(code||''); if(!/^\d{3}$/.test(code))throw fail('bad_code','Enter a three-digit room code.');
  const room=rooms.get(code); if(!room)throw fail('bad_code','Room not found.'); if(room.phase!=='lobby')throw fail('match_started','That match has already started.');
  const capacity=room.settings.mode==='battle'?8:4;if(room.players.length>=capacity)throw fail('room_full','That room is full.'); name=cleanName(name); if(!name)throw fail('bad_name','Enter a display name.');
  if(room.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw fail('name_taken','That name is already in use.');
  const p=player(name,ws); room.players.push(p); room.emptyAt=null; broadcastState(room); return {room,p};
}
function rejoin(code, token, ws) {
  const room=rooms.get(String(code||'')); if(!room)throw fail('room_gone','That room no longer exists.');
  const p=room.players.find(q=>q.token===token); if(!p)throw fail('bad_token','Saved room session is no longer valid.');
  if(p.hostTimer){clearTimeout(p.hostTimer);p.hostTimer=null;} p.ws=ws;p.connected=true;p.disconnectedAt=null;room.emptyAt=null;
  room.game?.setConnected(p.id,true); broadcastState(room); return {room,p};
}
function updateSettings(room,p,settings,revision) {
  if(room.hostId!==p.id)throw fail('not_host','Only the host can change settings.'); if(room.phase!=='lobby')throw fail('settings_locked','Settings are locked during a match.');
  if(Number(revision)!==room.revision)throw fail('stale_revision','Lobby settings changed; try again.');
  const next=validateSettings(settings);if(next.mode!=='battle'&&room.players.length>4)throw fail('too_many_players','Co-op modes support at most four players.');
  if(next.mode==='battle')next.field='classic';room.settings=next;room.revision++;broadcastState(room);
}
function makeGame(room){const seed=crypto.randomBytes(4).readUInt32LE();return room.settings.mode==='battle'?new BattleGame(room.settings,room.players,seed):new OnlineGame(room.settings,room.players,seed);}
function sendPlayer(p,type,payload={}){if(p.connected&&p.ws?.readyState===1)p.ws.send(JSON.stringify({type,...payload}));}
function broadcastMatchStarted(room){for(const p of room.players)sendPlayer(p,'match_started',{room:publicRoom(room),snapshot:room.game.snapshotFor(p.id,true)});}
function start(room,p) {
  if(room.hostId!==p.id)throw fail('not_host','Only the host can start.'); if(room.phase!=='lobby')throw fail('bad_phase','Match is already running.');
  const connected=room.players.filter(q=>q.connected); if(connected.length<2)throw fail('not_enough_players','At least two connected players are required.');
  room.players=connected; room.phase='playing'; room.game=makeGame(room);room.snapshotSeq=0;
  broadcastMatchStarted(room);
}
function requireHost(room,p){if(room.hostId!==p.id)throw fail('not_host','Only the host can control the match.');if(room.phase!=='playing')throw fail('bad_phase','No match is running.');}
function pause(room,p,value){requireHost(room,p);room.game.setPaused(value);broadcast(room,'phase_changed',{phase:value?'paused':'play'});}
function restart(room,p){requireHost(room,p);room.game=makeGame(room);room.snapshotSeq=0;broadcastMatchStarted(room);}
function returnToLobby(room,p){if(room.hostId!==p.id)throw fail('not_host','Only the host can return to the lobby.');if(!['playing','ended'].includes(room.phase))throw fail('bad_phase','Cannot return now.');room.players=room.players.filter(q=>q.connected);room.game=null;room.phase='lobby';room.revision++;broadcastState(room);}
function broadcastState(room){broadcast(room,'lobby_state',{room:publicRoom(room)});}
function transferHost(room,departed){if(room.hostId!==departed.id)return;const next=room.players.filter(q=>q.connected&&q!==departed).sort((a,b)=>a.joinedAt-b.joinedAt)[0];if(next){room.hostId=next.id;broadcast(room,'host_changed',{hostId:next.id});broadcastState(room);}}
function disconnect(room,p,explicit=false){if(!room||!p)return;p.connected=false;p.ws=null;p.disconnectedAt=Date.now();if(explicit&&room.settings.mode==='battle')room.game?.forfeit(p.id);else room.game?.setConnected(p.id,false);
  if(explicit){transferHost(room,p);if(room.phase==='lobby')room.players=room.players.filter(q=>q!==p);}
  else if(room.hostId===p.id)p.hostTimer=setTimeout(()=>{p.hostTimer=null;if(!p.connected)transferHost(room,p);},10_000);
  if(!room.players.some(q=>q.connected))room.emptyAt=Date.now();broadcastState(room);
}
function findBySocket(ws){for(const room of rooms.values()){const p=room.players.find(q=>q.ws===ws);if(p)return{room,p};}return{};}
function sweep(now=Date.now()){for(const [code,room] of rooms){if(room.emptyAt&&now-room.emptyAt>300_000){rooms.delete(code);continue;}if(room.phase==='lobby'){for(const p of [...room.players])if(!p.connected&&p.disconnectedAt&&now-p.disconnectedAt>60_000){transferHost(room,p);room.players.splice(room.players.indexOf(p),1);}if(!room.players.length)rooms.delete(code);}}for(const[k,hits]of limits)if(!hits.some(t=>now-t<60_000))limits.delete(k);}
function tick(dt){for(const room of rooms.values())if(room.phase==='playing'&&room.game){room.game.update(dt);if(['won','lost','ended'].includes(room.game.state))room.phase='ended';}}
function snapshots(){for(const room of rooms.values())if(room.game&&['playing','ended'].includes(room.phase)){const overview=room.settings.mode==='battle'&&++room.snapshotSeq%4===0;for(const p of room.players)sendPlayer(p,'snapshot',{snapshot:room.game.snapshotFor(p.id,overview),phase:room.phase});}}
function clear(){for(const room of rooms.values())for(const p of room.players)if(p.hostTimer)clearTimeout(p.hostTimer);rooms.clear();limits.clear();}

module.exports={DEFAULT_SETTINGS,rooms,create,join,rejoin,updateSettings,start,pause,restart,returnToLobby,disconnect,findBySocket,sweep,tick,snapshots,broadcastState,publicRoom,clear,fail};
