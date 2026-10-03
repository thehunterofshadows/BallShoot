'use strict';

/* Bubble Together 2: a separate 52-round campaign authored for the continuous 16/15
   two-player board. It deliberately does not modify the original LEVELS library. */
const CoopCampaigns = (() => {
  const WIDTHS = [16, 15], COLORS = ['R','Y','G','B','P','O'];
  const NAMES = [
    'Open Hands','Shared Roof','Twin Drops','Center Cut','Crossed Lines','Relay','Two Keys','Easy Bank','First Bridge','Together',
    'Side Swap','Pendulum Pair','Crosswind','Shared Canopy','Double Hook','Opposite Angles','Bank Exchange','Split Decision','Center Lane','Crossfire',
    'Stone Steps','Keystone Pair','Rock Bridge','Twin Towers','Stone Relay','Shared Gate','Counterweight','Canyon Keys','Falling Wall','Rock Garden',
    'Prism Relay','Rainbow Bridge','Twin Stars','Color Exchange','Star Circuit','Prism Cross','Chain Reaction','Aurora Link','Shared Spectrum','Fireworks',
    'Shield School','Shield Exchange','Sync Gate','Lockstep','Team Armor','Armor Relay','Corruption Line','Containment','Twin Locks','Hive Relay',
    'Grand Circuit','Bubble Together II'
  ];
  const hash = (a,b,c) => { let x=(a+1)*73856093^(b+1)*19349663^(c+1)*83492791; x^=x>>>13; x=Math.imul(x,1274126177); return (x>>>0)/4294967295; };
  const parents = (r,c) => { const p=r&1; return [c-1+p,c+p]; };
  const motifScore = (kind,r,c,w,i) => {
    const x=c+(r&1)*.5, mid=(w-1)/2, wave=Math.sin((x+r*1.6+i*.7)*.8)*.25;
    if(kind===0) return 1-Math.min(Math.abs(x-3.2),Math.abs(x-mid),Math.abs(x-12.1))/8+wave;
    if(kind===1) return 1-Math.abs(x-(mid+(r%2?2:-2)))/10+wave;
    if(kind===2) return 1-Math.min(Math.abs(x-(2.5+r*.65)),Math.abs(x-(13-r*.55)))/7+wave;
    if(kind===3) return 1-Math.min(Math.abs(x-2),Math.abs(x-7.5),Math.abs(x-13))/6+wave;
    if(kind===4) return 1-Math.min(Math.abs(x-(4+(r%3))),Math.abs(x-(11-(r%3))))/7+wave;
    return .65+.25*Math.cos((x-r*1.3+i)*.9)+wave;
  };
  const depthFor = i => i<10?4:i<20?5:i<30?6:i<40?7:i<46?8:9;
  const colorsFor = i => i<8?3:i<18?4:i<30?5:6;
  const dropFor = i => i<10?14:i<20?12:i<30?11:i<40?10:i<46?9:i<49?9:8;
  const targetFor = i => 36 + Math.round(i*0.9);
  const supported = (grid,r,c) => r===0 || parents(r,c).some(pc => pc>=0 && pc<grid[r-1].length && grid[r-1][pc]);
  const buildMask = i => {
    const depth=depthFor(i), target=targetFor(i), kind=i%6, grid=[]; let used=0;
    for(let r=0;r<depth;r++) {
      const w=WIDTHS[r&1], row=Array(w).fill(false), remainingRows=depth-r;
      let quota=Math.round((target-used)/remainingRows);
      quota=Math.max(r===0?8:4,Math.min(w,quota+(r===0?2:0)));
      const cand=[];
      for(let c=0;c<w;c++) if(r===0 || supported(grid,r,c)) cand.push({c,s:motifScore(kind,r,c,w,i)+hash(i,r,c)*.18});
      cand.sort((a,b)=>b.s-a.s);
      for(const q of cand.slice(0,Math.min(quota,cand.length))) row[q.c]=true;
      grid.push(row); used+=row.filter(Boolean).length;
    }
    // Fill any remaining budget with supported holes, highest-value first.
    while(used<target) {
      let best=null;
      for(let r=0;r<grid.length;r++) for(let c=0;c<grid[r].length;c++) if(!grid[r][c] && supported(grid,r,c)) {
        const s=motifScore(kind,r,c,grid[r].length,i)+hash(i+91,r,c)*.1;
        if(!best||s>best.s) best={r,c,s};
      }
      if(!best) break; grid[best.r][best.c]=true; used++;
    }
    return grid;
  };
  const paint = (grid,i) => {
    const n=colorsFor(i), rows=grid.map((row,r)=>row.map((on,c)=>on?COLORS[(Math.floor((c+(i%3))/2)+Math.floor(r/2)+(c>7?1:0)+i)%n]:'.'));
    const occupied=[]; for(let r=1;r<rows.length;r++) for(let c=0;c<rows[r].length;c++) if(rows[r][c]!=='.') occupied.push([r,c]);
    const choose=(salt,count,chars) => {
      const pool=occupied.slice().sort((a,b)=>hash(i+salt,b[0],b[1])-hash(i+salt,a[0],a[1]));
      let k=0; for(const [r,c] of pool) { if(k>=count) break; if(rows[r][c]==='.'||'#*+'.includes(rows[r][c])) continue; rows[r][c]=chars[k%chars.length]; k++; }
    };
    if(i>=20) choose(20,Math.min(2+Math.floor((i-20)/4),8),'#');
    if(i>=30) choose(40,Math.min(2+Math.floor((i-30)/5),5),'*+');
    if(i>=40) choose(60,2,'+*');
    return rows.map(a=>a.join(''));
  };
  const cells = rows => { const out=[]; rows.forEach((row,r)=>[...row].forEach((ch,c)=>{if(ch!=='.')out.push([r,c]);})); return out; };
  const pick = (rows, side='center', low=true, used=new Set()) => {
    const all=cells(rows).filter(([r,c])=>r>0&&!used.has(r+','+c));
    const mid=7.5, score=([r,c]) => (low?r*3:0) - (side==='left'?c:side==='right'?-c:Math.abs(c-mid)*2);
    all.sort((a,b)=>score(b)-score(a)); const v=all[0]||[0,0]; used.add(v[0]+','+v[1]); return v;
  };
  const objectsFor = (i,rows) => {
    if(i<40) return undefined; const used=new Set();
    if(i===40||i===41) return [{id:'leftShield',type:'shield',cells:[pick(rows,'left',true,used)]},{id:'rightShield',type:'shield',cells:[pick(rows,'right',true,used)]}];
    if(i===42||i===43||i===48) { const a=pick(rows,'left',true,used), b=pick(rows,'right',true,used), x=pick(rows,'center',false,used), y=pick(rows,'center',true,used); return [
      {id:'westLock',type:'syncLock',cells:[a],pair:'eastLock',barrier:[x,y]}, {id:'eastLock',type:'syncLock',cells:[b],pair:'westLock',barrier:[x,y]}]; }
    if(i===44||i===45||i===49) return [{id:'westArmor',type:'teamArmor',cells:[pick(rows,'left',true,used)]},{id:'eastArmor',type:'teamArmor',cells:[pick(rows,'right',true,used)]}];
    if(i===46||i===47) return [{id:'pressure',type:'corruption',cells:[pick(rows,'center',true,used)],every:6-(i-46),maxSpread:2+(i-46)}];
    if(i===50) return [{id:'westArmor',type:'teamArmor',cells:[pick(rows,'left',true,used)]},{id:'eastArmor',type:'teamArmor',cells:[pick(rows,'right',true,used)]},{id:'pressure',type:'corruption',cells:[pick(rows,'center',true,used)],every:5,maxSpread:3}];
    if(i===51) { const a=pick(rows,'left',true,used), b=pick(rows,'right',true,used), x=pick(rows,'center',false,used), y=pick(rows,'center',true,used); return [
      {id:'westLock',type:'syncLock',cells:[a],pair:'eastLock',barrier:[x,y]}, {id:'eastLock',type:'syncLock',cells:[b],pair:'westLock',barrier:[x,y]},
      {id:'pressure',type:'corruption',cells:[pick(rows,'center',true,used)],every:5,maxSpread:3}]; }
  };
  const COOP2_LEVELS = NAMES.map((name,i)=>{ const rows=paint(buildMask(i),i), objects=objectsFor(i,rows); return {name,drop:dropFor(i),rows,...(objects?{objects}:{})}; });
  const CAMPAIGNS = Object.freeze({
    original: {id:'original',name:'Original 52',subtitle:'The original Bubble Together campaign',profile:'original'},
    coop2: {id:'coop2',name:'Bubble Together 2',subtitle:'52 levels built for two-player co-op',profile:'coop2',players:2},
  });
  return { COOP2_LEVELS, CAMPAIGNS, WIDTHS };
})();
if(typeof module!=='undefined') module.exports=CoopCampaigns;
if(typeof globalThis!=='undefined') globalThis.CoopCampaigns=CoopCampaigns;
