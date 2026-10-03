'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OnlineGame, LEVELS, COOP2_LEVELS, CAMPAIGNS, GRID_PROFILES } = require('../server/game');
const CoopObjects = require('../coop-objects');
const lobbies = require('../server/lobbies');
const { Scores } = require('../server/scores');

const root=path.resolve(__dirname,'..');
const duo=[{id:'a',name:'Ada'},{id:'b',name:'Ben'}];
const supported = rows => {
  const has=(r,c)=>r>=0&&r<rows.length&&c>=0&&c<rows[r].length&&rows[r][c]!=='.';
  const seen=new Set(), stack=[];
  [...rows[0]].forEach((ch,c)=>{if(ch!=='.'){seen.add(`0,${c}`);stack.push([0,c]);}});
  while(stack.length){const [r,c]=stack.pop(),p=r&1,a=c-1+p,b=c+p;for(const [nr,nc] of [[r,c-1],[r,c+1],[r-1,a],[r-1,b],[r+1,a],[r+1,b]])if(has(nr,nc)&&!seen.has(`${nr},${nc}`)){seen.add(`${nr},${nc}`);stack.push([nr,nc]);}}
  return rows.every((row,r)=>[...row].every((ch,c)=>ch==='.'||seen.has(`${r},${c}`)));
};
const count=L=>L.rows.join('').replace(/\./g,'').length;

test('Original 52 and Bubble Together 2 are separate 52-level campaigns',()=>{
  assert.equal(LEVELS.length,52); assert.equal(COOP2_LEVELS.length,52);
  assert.equal(CAMPAIGNS.original.name,'Original 52');
  assert.equal(CAMPAIGNS.coop2.name,'Bubble Together 2');
  assert.notEqual(LEVELS,COOP2_LEVELS);
  assert.equal(new Set(COOP2_LEVELS.map(L=>L.name)).size,52);
  assert.equal(COOP2_LEVELS.at(-1).name,'Bubble Together II');
});

test('every sequel round is a supported native 16/15 two-player board',()=>{
  COOP2_LEVELS.forEach((L,i)=>{
    assert.ok(L.rows.length>=4&&L.rows.length<=12,`${i+1} depth`);
    L.rows.forEach((row,r)=>assert.equal(row.length,r%2?15:16,`${i+1} row ${r}`));
    assert.ok(supported(L.rows),`${i+1} supported`);
    assert.doesNotThrow(()=>CoopObjects.validate(L),`${i+1} objects`);
    assert.match(L.rows.join(''),/[RYGB]/,`${i+1} playable colours`);
  });
});

test('the sequel difficulty curve rises smoothly instead of containing a 47-style cliff',()=>{
  const cells=COOP2_LEVELS.map(count), drops=COOP2_LEVELS.map(L=>L.drop);
  for(let i=1;i<cells.length;i++) assert.ok(cells[i]>=cells[i-1]&&cells[i]-cells[i-1]<=2,`${i+1}: ${cells[i-1]} -> ${cells[i]}`);
  for(let i=1;i<drops.length;i++) assert.ok(drops[i]<=drops[i-1],`${i+1}: ceiling pace never relaxes`);
  assert.deepEqual([cells[0],cells[19],cells[39],cells[45],cells[51]],[36,53,71,77,82]);
  assert.deepEqual([drops[0],drops[19],drops[39],drops[45],drops[51]],[14,12,10,9,8]);
});

test('the sequel stages mechanics rather than introducing everything at once',()=>{
  assert.ok(COOP2_LEVELS.slice(0,20).every(L=>!/[#*+]/.test(L.rows.join(''))));
  assert.ok(COOP2_LEVELS.slice(20,30).every(L=>L.rows.join('').includes('#')));
  assert.ok(COOP2_LEVELS.slice(30,40).every(L=>/[+*]/.test(L.rows.join(''))));
  assert.ok(COOP2_LEVELS.slice(0,40).every(L=>!L.objects));
  assert.ok(COOP2_LEVELS.slice(40).some(L=>L.objects?.some(o=>o.type==='shield')));
  assert.ok(COOP2_LEVELS.slice(40).some(L=>L.objects?.some(o=>o.type==='syncLock')));
  assert.ok(COOP2_LEVELS.slice(40).some(L=>L.objects?.some(o=>o.type==='teamArmor')));
  assert.ok(COOP2_LEVELS.slice(40).some(L=>L.objects?.some(o=>o.type==='corruption')));
});

test('online Bubble Together 2 uses the full 16/15 field with exactly two launchers',()=>{
  const game=new OnlineGame({...lobbies.DEFAULT_SETTINGS,campaign:'coop2',mode:'clear',field:'classic',level:0},duo,7);
  assert.equal(game.cols,GRID_PROFILES.coop2.evenColumns);
  assert.equal(game.WW,2*12+2*28*GRID_PROFILES.coop2.evenColumns);
  assert.equal(game.grid.size,count(COOP2_LEVELS[0]));
  assert.equal(game.players.length,2);
  assert.deepEqual(game.players.map(p=>p.x),[game.WW*.25,game.WW*.75]);
});

test('room rules enforce the sequel as exactly two-player Co-op Clear',()=>{
  const {room,p}=lobbies.create('Host',null,'campaign-test');
  lobbies.updateSettings(room,p,{...room.settings,campaign:'coop2',mode:'clear',field:'classic',level:0},room.revision);
  lobbies.join(room.code,'Guest',null,'campaign-test-2');
  assert.throws(()=>lobbies.join(room.code,'Third',null,'campaign-test-3'),/full/i);
  assert.throws(()=>lobbies.updateSettings(room,p,{...room.settings,campaign:'coop2',mode:'battle'},room.revision),/two-player|campaign/i);
  lobbies.clear();
});

test('sequel high scores are bucketed separately from Original 52',()=>{
  assert.equal(Scores.bucketKey('clear',0,'original'),'clear:0');
  assert.equal(Scores.bucketKey('clear',0,'coop2'),'clear:coop2:0');
  assert.notEqual(Scores.bucketKey('clear',0,'original'),Scores.bucketKey('clear',0,'coop2'));
});

test('the browser exposes both campaigns and ships the shared campaign module',()=>{
  const client=fs.readFileSync(path.join(root,'coop-bubbles.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(client,/Original 52/); assert.match(client,/Bubble Together 2 · 52 co-op levels/);
  assert.match(client,/data-c="coop2"/); assert.match(client,/bt_progress_/);
  assert.match(html,/coop-campaigns\.js\?v=__CAMPAIGN_VERSION__/);
});
