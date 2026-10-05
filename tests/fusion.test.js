"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {OnlineGame,TEAM_POWER}=require('../server/game');
const {DEFAULT_SETTINGS}=require('../server/lobbies');
const component = fs.readFileSync(path.resolve(__dirname, '..', 'coop-bubbles.js'), 'utf8');
const loadComponent = () => {
  let Cls;
  const ctx = { CoopObjects: require('../coop-objects'), CoopCampaigns: require('../coop-campaigns'), HTMLElement: class {}, customElements: { get: () => null, define: (n, c) => { Cls = c; } },
    document: { addEventListener() {}, removeEventListener() {} }, Image: class {}, navigator: {}, performance: { now: () => 0 }, console,
    location: {}, localStorage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, clearTimeout() {}, cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), devicePixelRatio: 1,
    getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0', getPropertyValue: () => '' }) };
  ctx.window = ctx;
  vm.runInNewContext(component, ctx);
  return Cls;
};
const C = loadComponent();
/* A local game, reset with real rules; only the DOM-facing calls are stubbed. */
const local = (settings = {}) => {
  const g = Object.assign(Object.create(C.prototype), {
    online: false, state: 'play', H: 1080, LAUNCH_Y: 938, DANGER_Y: 846,
    settings: { players: 2, human: [true, true, false, false], mode: 'clear', field: 'classic', level: 0, reload: 0,
      missMax: 8, pressureShots: 8, hurry: 0, assist: 0.35, mateLines: true, sound: false, ...settings },
    hideOverlays() {}, showObjectGuide() {}, sfx() {}, callout() {},
  });
  g.resetGame();
  return g;
};

const roster=[{id:'a',name:'Ada'},{id:'b',name:'Ben'}];
const server=()=>new OnlineGame({...DEFAULT_SETTINGS,mode:'clear',level:0,hurry:0,assist:0,reload:0},roster,9);
const plain=x=>JSON.parse(JSON.stringify(x));
const arm=g=>{g.teamPowerCharge=100;if(g instanceof OnlineGame)assert.equal(g.activateTeamPower('a'),true);else g.requestTeamPower(0);assert.equal(g.teamPowerActive,'fusion');};
const fire=(g,i)=>g.fire(g instanceof OnlineGame?roster[i].id:i);
const put=(g,r,c,kind='G',special=null,extra={})=>{const b={r,c,kind,special,placedBy:-1,at:0,...extra};g.grid.set(`${r},${c}`,b);return b;};
const land=(g,i,r,c)=>{fire(g,i);const f=g.flights.pop();assert.equal(f.special,'fusion');f.x=g.cellX(r,c);f.y=g.cellY(r);g.land(f);};
const board=g=>{g.grid.clear();g.objects=[];g.batch=[];g.resolveAt=0;g.gridTop=92;g.gridTopTarget=92;
 for(let c=2;c<=9;c++)put(g,0,c,'R');
 for(let r=1;r<=6;r++)put(g,r,5,'GBY'[r%3]);
 put(g,6,6,'P','rainbow',{tag:'saved-special'});g.updateLowest();return g;};
const legal=g=>{for(const [k,b]of g.grid){assert.equal(k,`${b.r},${b.c}`);assert.ok(b.r>=g.anchorRow&&b.c>=0&&b.c<g.colsIn(b.r));}
 const before=g.grid.size;if(g instanceof OnlineGame)assert.equal(g.removeFloaters().length,0);else assert.equal(g.supportCheck().n,0);assert.equal(g.grid.size,before);};

test('default duo equips Fusion; temporary shots preserve cur/next through firing and repeated cancellation',()=>{
 assert.equal(TEAM_POWER.equipped,'fusion');
 for(const make of [server,local]){const g=make();const saved=g.players.map(p=>({cur:plain(p.cur),next:plain(p.next)}));
 for(let i=0;i<10;i++){arm(g);assert.deepEqual(plain(g.players.map(p=>p.cur.special)),['fusion','fusion']);
 fire(g,0);assert.deepEqual(plain(g.players[0].cur),saved[0].cur);assert.deepEqual(plain(g.players[0].next),saved[0].next);
 g.now=g.fusion.fireBy+.01;g.update(.01);assert.equal(g.fusion,null);assert.equal(g.teamPowerCharge,100);
 assert.equal(g.flights.filter(f=>f.special==='fusion').length,0);
 for(let j=0;j<2;j++){assert.deepEqual(plain(g.players[j].cur),saved[j].cur);assert.deepEqual(plain(g.players[j].next),saved[j].next);}}
 }
});

test('two endpoints cut the corridor and reattach special survivors with identical local/server results',()=>{
 const games=[board(server()),board(local())];
 for(const g of games){arm(g);land(g,0,2,4);assert.equal(g.fusion.phase,'armed');assert.equal(g.fusion.endpoints.length,1);
 const before=[...g.grid.values()].filter(b=>b.special!=='fusion').length;
 land(g,1,2,6);assert.equal(g.fusion.phase,'burst');assert.equal(g.teamPowerTimer,2.6);
 assert.ok(g.fusion.popped.length>0);assert.ok(g.fusion.moved.length>0);
 assert.equal(g.grid.size+g.fusion.popped.length,before,'reverse gravity neither removes nor duplicates survivors');
 assert.ok([...g.grid.values()].some(b=>b.tag==='saved-special'&&b.special==='rainbow'));
 for(const m of g.fusion.moved)assert.ok(m.to.r<=m.from.r,'survivor moves upward');
 assert.equal(g.score,g.fusion.popped.length*10,'no drop or distance farming points');assert.equal(g.missMeter,0);legal(g);
 const snap=plain(g instanceof OnlineGame?g.snapshot():g.fusion);assert.ok(snap);
 }
 const view=g=>plain({grid:[...g.grid.values()],fusion:g.fusion,score:g.score,miss:g.missMeter});
 assert.deepEqual(view(games[0]),view(games[1]));
});

test('normal shots continue immediately during the 2.6 second presentation',()=>{
 const g=board(server());arm(g);land(g,0,2,4);land(g,1,2,6);const next=g.players[0].next;
 assert.equal(g.fire('a'),true);assert.equal(g.players[0].cur,next);assert.notEqual(g.flights.at(-1).special,'fusion');
});

test('disconnection, endpoint destruction, flight timeout and no snap location refund safely',()=>{
 for(const mode of ['disconnect','destroy','flight','nosnap']){const g=board(server());arm(g);
 if(mode==='nosnap'){g.snapCell=()=>null;land(g,0,2,4);}
 else if(mode==='flight'){fire(g,0);fire(g,1);g.now=g.fusion.landBy+.01;g.update(.01);}
 else {land(g,0,2,4);if(mode==='disconnect')g.setConnected('b',false);else {g.grid.delete('2,4');g.update(.01);}}
 assert.equal(g.fusion,null,mode);assert.equal(g.teamPowerCharge,100);assert.ok(g.players.every(p=>p.cur.special!=='fusion'&&!p.fusionStored));
 assert.ok([...g.grid.values()].every(b=>b.special!=='fusion'));legal(g);}
});

test('timeout restores supports for a normal shot placed beneath the waiting endpoint',()=>{
 const g=server();g.grid.clear();put(g,0,4);arm(g);land(g,0,1,4);put(g,2,4,'B',null,{tag:'normal'});
 g.now=g.fusion.fireBy+.01;g.update(.01);assert.ok([...g.grid.values()].some(b=>b.tag==='normal'));assert.equal(g.grid.size,2);legal(g);
});

test('both fired before four seconds may finish in flight; snapshots carry assignments/endpoints/results',()=>{
 const g=board(server());arm(g);land(g,0,2,4);fire(g,1);const f=g.flights.pop();g.now=4.2;g.update(.01);assert.equal(g.fusion.phase,'armed');
 let s=plain(g.snapshot());assert.deepEqual(s.fusion.fired,[0,1]);assert.equal(s.fusion.endpoints.length,1);
 f.x=g.cellX(2,6);f.y=g.cellY(2);g.land(f);s=plain(g.snapshot());assert.equal(s.fusion.phase,'burst');assert.ok(s.fusion.moved.length);
 assert.ok(s.events.some(e=>e.kind==='fusion_burst'));assert.equal(s.teamPowerTimer,2.6);
});

test('Fusion rejects pass, bomb reserves, a disconnected partner and duplicate activation',()=>{
 const g=server();arm(g);assert.equal(g.requestPass('a'),false);assert.equal(g.requestBombToggle('a'),false);assert.equal(g.activateTeamPower('b'),false);
 const disconnected=server();disconnected.setConnected('b',false);disconnected.teamPowerCharge=100;assert.equal(disconnected.activateTeamPower('a'),false);
 const bomb=server();bomb.requestBombToggle('b');bomb.teamPowerCharge=100;assert.equal(bomb.activateTeamPower('a'),false);assert.equal(bomb.teamPowerCharge,100);
});

test('stones and protected objects survive a cut; relocated object coordinates and metadata follow their cells',()=>{
 const g=board(server());put(g,2,5,'#','stone');put(g,5,5,'B',null,{tag:'shield'});
 g.objects=[{id:'shield',type:'shield',state:'ready',cells:[[5,5]],spread:[],timer:0}];
 arm(g);land(g,0,2,4);land(g,1,2,6);assert.ok([...g.grid.values()].some(b=>b.special==='stone'));assert.equal(g.objects[0].state,'ready');
 const shield=[...g.grid.values()].find(b=>b.tag==='shield');assert.deepEqual(g.objects[0].cells,[[shield.r,shield.c]]);legal(g);
});

test('protected object below a severed support moves without being completed',()=>{
 const g=board(server());put(g,5,5,'B',null,{tag:'shield'});g.objects=[{id:'shield',type:'shield',state:'ready',cells:[[5,5]],spread:[],timer:0}];
 arm(g);land(g,0,2,4);land(g,1,2,6);const cell=[...g.grid.values()].find(b=>b.tag==='shield');assert.ok(cell.r<5);
 assert.deepEqual(g.objects[0].cells,[[cell.r,cell.c]]);assert.equal(g.objects[0].state,'ready');legal(g);
});

test('neighboring ceiling endpoints can complete an empty board without a miss',()=>{
 const g=server();g.grid.clear();arm(g);land(g,0,0,0);assert.equal(g.state,'play');land(g,1,0,1);
 assert.equal(g.grid.size,0);assert.equal(g.state,'levelup');assert.equal(g.missMeter,0);assert.ok(g.players.every(p=>!p.fusionStored));
});

const {WebSocket}=require('ws');
const {createServer}=require('../server/server');
function client(url){
  const ws=new WebSocket(url),queue=[],waiters=[];
  ws.on('message',raw=>{const msg=JSON.parse(raw);const i=waiters.findIndex(w=>w.type===msg.type);if(i>=0)waiters.splice(i,1)[0].resolve(msg);else queue.push(msg);});
  const opened=new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  return {ws,opened,send(value){ws.send(JSON.stringify(value));},next(type){const i=queue.findIndex(m=>m.type===type);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timed out waiting for ${type}`)),2500);waiters.push({type,resolve:m=>{clearTimeout(timer);resolve(m);}});});}};
}

test('Fusion over the socket client-supplied charge is ignored and simultaneous requests fire once', async () => {
  const app=createServer();await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
  const a=client(url),b=client(url);await Promise.all([a.opened,b.opened]);
  try {
    a.send({type:'create',name:'Alpha'});const aj=await a.next('joined');
    b.send({type:'join',code:aj.room.code,name:'Bravo'});await b.next('joined');
    await a.next('lobby_state');
    a.send({type:'update_settings',revision:aj.room.revision,settings:{...aj.room.settings,mode:'clear',level:0}});
    await a.next('lobby_state');
    a.send({type:'start'});await Promise.all([a.next('match_started'),b.next('match_started')]);
    const game=require('../server/lobbies').rooms.get(aj.room.code).game;
    a.send({type:'team_power',charge:100,power:'fusion'});
    await new Promise(r=>setTimeout(r,60));
    assert.equal(game.teamPowerActive,null,'an empty meter cannot be talked into firing');
    game.teamPowerCharge=TEAM_POWER.max;
    a.send({type:'team_power'});b.send({type:'team_power'});
    for(let i=0;i<40&&!game.events.some(e=>e.kind==='team_power_activated');i++)await new Promise(r=>setTimeout(r,10));
    await new Promise(r=>setTimeout(r,50));
    assert.equal(game.events.filter(e=>e.kind==='team_power_activated').length,1);
    let snap;for(let i=0;i<8;i++){snap=(await b.next('snapshot')).snapshot;if(snap.teamPowerActive)break;}
    assert.equal(snap.teamPowerActive,'fusion','the partner sees the burst');
    assert.equal(snap.teamPowerCharge,0);
  } finally {
    a.ws.terminate();b.ws.terminate();app.wss.close();await new Promise(resolve=>app.server.close(resolve));
  }
});


test('wall, ceiling, diagonal and vertical cuts leave legal supported boards across both campaigns',()=>{
 for(const campaign of ['original','coop2'])for(let level=0;level<52;level++) {
  const g=new OnlineGame({...DEFAULT_SETTINGS,mode:'clear',campaign,level,hurry:0,reload:0},roster,level+1);
  arm(g);
  for(let i=0;i<2;i++){
   fire(g,i);const f=g.flights.pop();
   f.x=level%3===0?g.cellX(0,0):g.cellX(0,i?g.cols-1:0);
   f.y=g.cellY(level%3===1?0:2+i*2);g.land(f);
  }
  assert.equal(g.fusion.phase,'burst',`${campaign} ${level}`);legal(g);
  for(const m of g.fusion.moved)assert.ok(m.to.r<=m.from.r);
  assert.ok(g.players.every(p=>!p.fusionStored&&p.cur.special!=='fusion'));
 }
});

test('danger clock is held, pauses preserve the fire window, and normal clocks resume on cancel',()=>{
 const g=server();g.danger={t:2,max:4};g.anyDangerCells=()=>true;arm(g);
 g.update(.05);assert.equal(g.danger.t,2);const deadline=g.fusion.fireBy;
 g.setPaused(true);for(let i=0;i<120;i++)g.update(.05);assert.equal(g.fusion.fireBy,deadline);assert.equal(g.now,.05);
 g.setPaused(false);g.now=deadline+.01;g.update(.05);assert.equal(g.fusion,null);assert.ok(g.danger.t<2);
});

test('a pending normal shot cut by Fusion cannot resolve against a replacement cell',()=>{
 for(const make of [server,local]){
  const g=board(make());const pending=g.grid.get('2,5');pending.placedBy=0;pending.fired=0;g.batch=[pending];g.resolveAt=.2;
  arm(g);land(g,0,2,4);land(g,1,2,6);const before=g.grid.size,score=g.score;
  g.resolveBatch();assert.equal(g.grid.size,before);assert.equal(g.score,score);assert.equal(g.missMeter,0);
 }
});

test('four-player co-op retains Synergy and no orphaned Fusion state remains after presentation',()=>{
 const g=new OnlineGame({...DEFAULT_SETTINGS,mode:'clear'},[...roster,{id:'c'},{id:'d'}],9);g.teamPowerCharge=100;
 assert.equal(g.activateTeamPower('a'),true);assert.equal(g.teamPowerActive,'synergy');assert.equal(g.players.filter(p=>p.cur.special==='rainbow').length,4);
 const duo=board(server());arm(duo);land(duo,0,2,4);land(duo,1,2,6);for(let i=0;i<53;i++)duo.update(.05);
 assert.equal(duo.teamPowerActive,null);assert.equal(duo.fusion,null);
});


test('cancellation of the last waiting endpoint completes an otherwise cleared board',()=>{
 const g=server();g.grid.clear();arm(g);land(g,0,0,0);g.now=g.fusion.fireBy+.01;g.update(.01);
 assert.equal(g.state,'levelup');assert.equal(g.grid.size,0);assert.equal(g.teamPowerCharge,100);
 assert.ok(g.players.every(p=>!p.fusionStored&&p.cur.special!=='fusion'));
});
