'use strict';

const W = 640, R = 28, X0 = 12;
const ROWH = R * Math.sqrt(3), GRIDTOP0 = 108;
/* Mirror of the client geometry in coop-bubbles.js: the field is always 640 wide and
   11 columns, but the world height comes from the room's viewH so the whole table
   shares one danger line no matter what each player's device looks like. */
const H0 = 1080, VIEWH_MIN = H0, VIEWH_MAX = 1560, LAUNCH_GAP = 142, DANGER_GAP = 92;
const KINDS = ['R', 'Y', 'G', 'B'];
const LEVELS = [
  ["GGBYRGBYYGB","BRRGBYRGBY","RGGYRGBYRGB","BYRBBYRGBY","RGBYYGBYRGB","BYRGBYRGBY","RGBY...YRGB","BYRG...GBY","RGB.....RGB","BY.......Y"],
  ["YYRBGYRBBYR","RGGYRBGYRB","GYYBGYRBGYR","RBGRRBGYRB","GYRBBYRBGYR","RBGYRBGYRB","GYRBGYRBGYR","BB.RR...BB","BB.RR....BB"],
  ["RRYGBRYGGRY","YBBRYGBRYG","BRRGBRYGBRY","YGBYYGBRYG","BRYGGRYGBRY","YGBR...RYG","BRYG...GBRY","YGBR...RYG","BRYG...GBRY","YGB.....YG","BR.......RY"],
  ["YBGRY......","GRYBGG....","YBGRY.BRYBG","GRYB..YBGR","YBGRR.GRYBG","GRYB..YBGR","YBGRY.RRYBG","GRYB..YGGR","BBGRY.GRRBG","GYYB..YBGR"],
];
const key = (r, c) => `${r},${c}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const geom = vh => {
  const H = clamp(Math.round((Number(vh) || H0) / 20) * 20, VIEWH_MIN, VIEWH_MAX), LAUNCH_Y = H - LAUNCH_GAP;
  return { H, LAUNCH_Y, DANGER_Y: LAUNCH_Y - DANGER_GAP };
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

class OnlineGame {
  constructor(settings, roster, seed, hooks = {}) {
    this.settings = structuredClone(settings);
    this.roster = roster.map((p, i) => ({ id: p.id, name: p.name, i }));
    this.random = mulberry32(seed);
    this.hooks = hooks;
    this.battle = this.settings.mode === 'battle';
    this.tickId = 0;
    this.state = 'play';
    this.reset();
  }

  rnd(a, b) { return a + this.random() * (b - a); }
  /* `carry` is set only by the Clear-mode level chain: it rebuilds the board for the
     next level while keeping the running score, per-player stats, connection state and
     the clock. The miss meter, pressure and danger timer deliberately do NOT carry —
     a fresh full board plus an almost-full miss meter would descend immediately. */
  reset(carry = null) {
    const S = this.settings;
    Object.assign(this, geom(S.viewH));
    this.WW = !this.battle && S.field === 'wide' ? W * 4 : W;
    this.cols = Math.floor((this.WW - 2 * X0) / (2 * R));
    this.grid = new Map(); this.parityFlip = 0; this.anchorRow = 0;
    this.gridTop = GRIDTOP0; this.gridTopTarget = GRIDTOP0;
    const rows = this.levelRows();
    const offs = S.field === 'wide' ? [1, 12, 23, 34] : [0];
    for (const off of offs) rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) if (row[i] !== '.') {
        const c = i + off;
        this.grid.set(key(r, c), { r, c, kind: row[i], special: null, placedBy: -1 });
      }
    });
    this.removeFloaters();
    this.flights = []; this.batch = []; this.resolveAt = 0;
    this.score = carry ? carry.score : 0;
    this.dispScore = carry ? carry.score : 0; this.missMeter = 0; this.danger = null;
    this.rowTimer = 0; this.shotCount = 0; this.specialFlip = 0; this.pressure = 0;
    this.chain = { mult: 1, last: -1, same: 0, players: new Set(), t: 0 };
    if (!carry) { this.now = 0; this.events = []; this.eventId = 0; this.paused = false; }
    const prior = carry ? new Map(carry.players.map(p => [p.id, p])) : null;
    this.players = this.roster.map((member, i) => {
      const was = prior?.get(member.id);
      return {
        ...member, x: this.WW * (i + 0.5) / this.roster.length,
        angle: was ? was.angle : this.rnd(-0.3, 0.3), cur: null, next: null, reload: 0,
        held: { l: false, r: false }, connected: was ? was.connected : true,
        stats: was ? was.stats : { shots: 0, pops: 0, bubbles: 0, assists: 0, drops: 0, rescues: 0, attacks: 0 },
      };
    });
    for (const p of this.players) { p.cur = this.genBubble(); p.next = this.genBubble(); }
    this.updateLowest();
    this.emit('round_started', { seed: this.tickId });
  }

  levelRows() {
    if (this.settings.level === 'custom') {
      const rows = String(this.settings.customText || '').split('\n')
        .map(s => s.trim().toUpperCase().replace(/[^RGYB.]/g, '.')).filter(Boolean).slice(0, 12)
        .map((s, r) => (s + '.'.repeat((r % 2) ? 10 : 11)).slice(0, (r % 2) ? 10 : 11));
      if (rows.some(s => /[RGYB]/.test(s))) return rows;
    }
    return LEVELS[Number(this.settings.level) || 0] || LEVELS[0];
  }
  par(r) { return (r + this.parityFlip) & 1; }
  colsIn(r) { return this.par(r) ? this.cols - 1 : this.cols; }
  cellX(r, c) { return X0 + R + c * 2 * R + this.par(r) * R; }
  cellY(r) { return this.gridTop + R + r * ROWH; }
  ceilingY() { return this.gridTop + this.anchorRow * ROWH; }
  neighbors(r, c) {
    const p = this.par(r), a = c - 1 + p, b = c + p;
    return [[r,c-1],[r,c+1],[r-1,a],[r-1,b],[r+1,a],[r+1,b]];
  }
  validCell(r, c) {
    if (c < 0 || c >= this.colsIn(r) || r < this.anchorRow || this.grid.has(key(r,c))) return false;
    return r === this.anchorRow || this.neighbors(r,c).some(([rr,cc]) => this.grid.has(key(rr,cc)));
  }
  updateLowest() {
    this.lowestY = 0;
    this.grid.forEach(b => { this.lowestY = Math.max(this.lowestY, this.cellY(b.r)); });
  }
  removeFloaters() {
    const safe = new Set(), stack = [];
    this.grid.forEach((b, k) => { if (b.r === this.anchorRow) { safe.add(k); stack.push(b); } });
    while (stack.length) {
      const b = stack.pop();
      for (const [r,c] of this.neighbors(b.r,b.c)) {
        const k = key(r,c), n = this.grid.get(k);
        if (n && !safe.has(k)) { safe.add(k); stack.push(n); }
      }
    }
    const dropped = [];
    this.grid.forEach((b, k) => { if (!safe.has(k)) { dropped.push(b); this.grid.delete(k); } });
    return dropped;
  }
  availKinds() {
    const s = new Set();
    this.grid.forEach(b => { if (!b.special) s.add(b.kind); });
    this.flights.forEach(b => { if (!b.special) s.add(b.kind); });
    return s.size ? [...s] : ['R'];
  }
  genBubble() {
    this.shotCount++;
    if (this.shotCount > 6 && this.shotCount % 11 === 0)
      return { kind: 'R', special: (this.specialFlip++ % 2) ? 'bomb' : 'rainbow' };
    const kinds = this.availKinds();
    return { kind: kinds[(this.random() * kinds.length) | 0], special: null };
  }
  refreshQueues() {
    const kinds = this.availKinds(), available = new Set(kinds);
    for (const p of this.players) for (const slot of ['cur','next']) {
      const b = p[slot];
      if (b && !b.special && !available.has(b.kind)) b.kind = kinds[(this.random() * kinds.length) | 0];
    }
  }
  snapCell(x, y) {
    const rr = Math.max(this.anchorRow, Math.round((y - this.gridTop - R) / ROWH));
    let best = null, distance = Infinity;
    for (let r = Math.max(this.anchorRow, rr - 5); r <= rr + 5; r++) for (let c = 0; c < this.colsIn(r); c++) {
      if (!this.validCell(r,c)) continue;
      const d = (this.cellX(r,c)-x) ** 2 + (this.cellY(r)-y) ** 2;
      if (d < distance) { distance = d; best = { r, c }; }
    }
    return best;
  }
  hitGrid(x, y) {
    const rr = Math.round((y - this.gridTop - R) / ROWH), lim = (2 * R * 0.88) ** 2;
    for (let r = Math.max(this.anchorRow, rr - 1); r <= rr + 1; r++) for (let c = 0; c < this.colsIn(r); c++) {
      if (this.grid.has(key(r,c)) && (this.cellX(r,c)-x) ** 2 + (this.cellY(r)-y) ** 2 < lim) return true;
    }
    return false;
  }
  matchGroup(r, c, kind) {
    const seen = new Set([key(r,c)]), stack = [[r,c]];
    while (stack.length) {
      const [rr,cc] = stack.pop();
      for (const [nr,nc] of this.neighbors(rr,cc)) {
        const k = key(nr,nc), b = this.grid.get(k);
        if (!seen.has(k) && b && (b.kind === kind || b.special === 'rainbow')) { seen.add(k); stack.push([nr,nc]); }
      }
    }
    return seen;
  }
  hypoSize(r, c, kind) { return this.matchGroup(r, c, kind).size; }

  setConnected(id, connected) { const p = this.players.find(q => q.id === id); if (p) { p.connected = connected; if (!connected) p.held = { l:false, r:false }; } }
  input(id, held) {
    const p = this.players.find(q => q.id === id);
    if (p && p.connected && this.state === 'play') p.held = { l: !!held.l, r: !!held.r };
  }
  fire(id) {
    const p = this.players.find(q => q.id === id);
    if (!p || !p.connected || this.state !== 'play' || this.paused || this.inputLocked || p.reload > 0) return false;
    const a = clamp(p.angle, -1.22, 1.22), sp = 1150;
    this.flights.push({ p: p.i, x: p.x, y: this.LAUNCH_Y - 44, vx: Math.sin(a)*sp, vy: -Math.cos(a)*sp,
      kind: p.cur.kind, special: p.cur.special, trail: [], bounceCd: 0 });
    p.cur = p.next; p.next = this.genBubble(); p.reload = this.settings.reload; p.stats.shots++; this.pressure++;
    this.emit('launch', { player: p.i, x: p.x, angle: a });
    return true;
  }
  /* Exchange the loaded bubble with the on-deck one. Gated on the same reload timer
     as fire() so it cannot be used as a free re-roll mid-cooldown. */
  swap(id) {
    const p = this.players.find(q => q.id === id);
    if (!p || !p.connected || this.state !== 'play' || this.paused || this.inputLocked || p.reload > 0) return false;
    if (!p.cur || !p.next) return false;
    const held = p.cur; p.cur = p.next; p.next = held;
    this.emit('swap', { player: p.i });
    return true;
  }
  emit(kind, data = {}) { this.events.push({ id: ++this.eventId, kind, data, at: this.now }); if (this.events.length > 128) this.events.shift(); }

  update(dt) {
    if (this.state !== 'play' || this.paused) return;
    dt = Math.min(0.05, dt); this.now += dt; this.tickId++;
    this.gridTop += clamp(this.gridTopTarget - this.gridTop, -80*dt, 80*dt);
    for (const p of this.players) {
      p.reload = Math.max(0, p.reload - dt);
      if (!p.connected || this.inputLocked) continue;
      const spd = (Number(this.settings.aimSpeed) || 2.4) * dt;
      if (p.held.l) p.angle = clamp(p.angle - spd, -1.22, 1.22);
      if (p.held.r) p.angle = clamp(p.angle + spd, -1.22, 1.22);
    }
    this.stepFlights(dt);
    if (this.resolveAt && this.now >= this.resolveAt) this.resolveBatch();
    const perDrop = this.shotsPerDrop();
    if (perDrop && this.pressure >= perDrop && !this.resolveAt) {
      this.pressure = 0; this.descendRow(); this.emit('ceiling');
    }
    if (this.chain.t > 0 && (this.chain.t -= dt) <= 0) this.chain = { mult:1, last:-1, same:0, players:new Set(), t:0 };
    const danger = this.anyDangerCells();
    if (danger && !this.danger) { this.danger = { t:this.settings.rescueDur, max:this.settings.rescueDur }; this.emit('warn'); }
    else if (!danger && this.danger) this.danger = null;
    if (this.danger && (this.danger.t -= dt) <= 0) return this.end(false);
    if (this.settings.mode === 'endless') {
      this.rowTimer += dt;
      if (this.rowTimer > Math.max(10, 24 - this.now/30) && !this.resolveAt) { this.rowTimer = 0; this.addRow(); }
      if (!this.grid.size) { this.addRow(); this.addRow(); }
    }
    this.dispScore += (this.score - this.dispScore) * Math.min(1, 10*dt);
  }
  stepFlights(dt) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]; f.trail.push({x:f.x,y:f.y}); if (f.trail.length > 16) f.trail.shift();
      let dist = Math.hypot(f.vx,f.vy)*dt, landed = false;
      while (dist > 0 && !landed) {
        const step = Math.min(dist, R*.45); dist -= step; const m = step/Math.hypot(f.vx,f.vy);
        f.x += f.vx*m; f.y += f.vy*m;
        if (f.x < X0+R) { f.x = 2*(X0+R)-f.x; f.vx = -f.vx; this.emit('bounce',{x:f.x,y:f.y}); }
        if (f.x > this.WW-X0-R) { f.x = 2*(this.WW-X0-R)-f.x; f.vx = -f.vx; this.emit('bounce',{x:f.x,y:f.y}); }
        landed = f.y <= this.ceilingY()+R || (f.y < this.lowestY+2.2*R && this.hitGrid(f.x,f.y));
      }
      if (landed) { this.flights.splice(i,1); this.land(f); }
      else if (f.y > this.H+60) this.flights.splice(i,1);
    }
  }
  land(f) {
    let cell = this.snapCell(f.x,f.y); if (!cell) return;
    if (!f.special && this.settings.assist > 0 && this.hypoSize(cell.r,cell.c,f.kind) < 3) {
      for (const [r,c] of this.neighbors(cell.r,cell.c)) if (this.validCell(r,c) &&
        Math.hypot(this.cellX(r,c)-f.x,this.cellY(r)-f.y) < 2.7*R && this.hypoSize(r,c,f.kind) >= 3 && this.random() < this.settings.assist) { cell={r,c}; break; }
    }
    const b = { ...cell, kind:f.kind, special:f.special, placedBy:f.p };
    this.grid.set(key(cell.r,cell.c),b); this.batch.push(b); this.resolveAt ||= this.now+.2; this.updateLowest();
    this.emit('attach',{player:f.p,r:cell.r,c:cell.c});
  }
  resolveBatch() {
    const landed=this.batch; this.batch=[]; this.resolveAt=0; const results=[];
    for (const b of landed) {
      if (!this.grid.has(key(b.r,b.c))) { results.push({shooter:b.placedBy,gone:true}); continue; }
      if (b.special==='bomb') {
        const bx=this.cellX(b.r,b.c), by=this.cellY(b.r), popped=new Set([key(b.r,b.c)]);
        this.grid.forEach((g,k)=>{ if(Math.hypot(this.cellX(g.r,g.c)-bx,this.cellY(g.r)-by)<=R*4.3)popped.add(k); });
        results.push({shooter:b.placedBy,popped,bomb:true});
      } else {
        let kind=b.kind;
        if(b.special==='rainbow'){
          let best=null,size=0; for(const [r,c] of this.neighbors(b.r,b.c)){const n=this.grid.get(key(r,c)); if(n&&!n.special){const s=this.matchGroup(b.r,b.c,n.kind).size;if(s>size){size=s;best=n.kind;}}}
          if(!best){results.push({shooter:b.placedBy});continue;} kind=best;
        }
        const group=this.matchGroup(b.r,b.c,kind); results.push({shooter:b.placedBy,popped:group.size>=3?group:null});
      }
    }
    const all=new Set(), owners=new Set(), clearers=[];
    for(const result of results) if(result.popped){let fresh=0; result.popped.forEach(k=>{if(!all.has(k)&&this.grid.has(k)){const b=this.grid.get(k);if(b.placedBy>=0&&b.placedBy!==result.shooter)owners.add(b.placedBy);all.add(k);fresh++;}});if(fresh)clearers.push(result.shooter);}
    const popped=[]; all.forEach(k=>{const b=this.grid.get(k);if(b){popped.push(b);this.grid.delete(k);}});
    const dropped=this.removeFloaters(); this.updateLowest();
    if(popped.length){if(!this.battle)clearers.forEach(i=>this.registerClear(i));const pts=this.popPoints(popped.length)*(this.battle?1:this.chain.mult);this.score+=pts;for(const i of clearers){const p=this.players[i];if(p){p.stats.pops++;p.stats.bubbles+=popped.length;}}owners.forEach(i=>{if(this.players[i])this.players[i].stats.assists++;});this.missMeter=Math.max(0,this.missMeter-1);this.emit('pop',{bubbles:popped,points:pts});}
    const misses=results.filter(r=>!r.popped&&!r.gone&&!r.bomb).length;
    if(misses){this.missMeter+=misses;if(this.missMeter>=this.settings.missMax*0.6){this.chain.mult=1;this.chain.players.clear();}if(this.missMeter>=this.settings.missMax){this.missMeter=0;this.descendRow();this.emit('ceiling');}}
    if(dropped.length){const pts=this.dropPoints(dropped.length,this.countComponents(dropped))*(this.battle?1:this.chain.mult);this.score+=pts;clearers.forEach(i=>{if(this.players[i])this.players[i].stats.drops+=dropped.length;});this.missMeter=dropped.length>=8?0:Math.max(0,this.missMeter-3);this.emit('drop',{bubbles:dropped,points:pts});}
    if(this.danger&&!this.anyDangerCells()){this.danger=null;this.score+=500;clearers.forEach(i=>{if(this.players[i])this.players[i].stats.rescues++;});this.emit('rescue');}
    this.refreshQueues();
    const total=popped.length+dropped.length;
    if(this.battle&&total>=6){const amount=clamp(2+Math.round(total*.7),3,14);this.emit('attack_ready',{amount});this.hooks.onAttack?.(amount);}
    if(this.battle&&!this.grid.size)this.refillBattleBoard();
    if(this.settings.mode==='clear'&&!this.grid.size&&this.state==='play')this.clearLevel();
  }
  /* Clear mode chains the authored levels instead of stopping at the first one. A
     custom level has nowhere to advance to, so it still ends the run. */
  levelIndex() { return this.settings.level === 'custom' ? -1 : (Number(this.settings.level) || 0); }
  nextLevelIndex() {
    const i = this.levelIndex();
    return i >= 0 && i + 1 < LEVELS.length ? i + 1 : -1;
  }
  levelBonus() {
    let shots = 0, pops = 0;
    for (const p of this.players) { shots += p.stats.shots; pops += p.stats.pops; }
    const accuracy = shots ? pops / shots : 0;
    const headroom = Math.max(0, this.settings.missMax - this.missMeter) / Math.max(1, this.settings.missMax);
    return Math.round(accuracy * 1500) + Math.round(headroom * 500);
  }
  clearLevel() {
    const from = this.levelIndex(), next = this.nextLevelIndex(), bonus = this.levelBonus();
    this.score += bonus;
    if (next < 0) { this.emit('level_cleared', { level: from, bonus, final: true }); return this.end(true); }
    this.emit('level_cleared', { level: from, next, bonus, final: false });
    this.settings.level = next;
    this.reset({ score: this.score, players: this.players });
  }
  refillBattleBoard(){
    this.score+=1000;this.gridTop=GRIDTOP0;this.gridTopTarget=GRIDTOP0;this.parityFlip=0;this.anchorRow=0;this.pressure=0;
    const rows=this.levelRows();for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++)if(rows[r][c]!=='.')this.grid.set(key(r,c),{r,c,kind:rows[r][c],special:null,placedBy:-1});
    this.removeFloaters();this.updateLowest();this.refreshQueues();this.emit('field_refilled',{points:1000});
  }
  addGarbage(amount,fromId){
    let added=0;
    for(let g=0;g<amount;g++){
      const candidates=[],maxR=Math.floor((this.DANGER_Y-this.gridTop)/ROWH);
      for(let r=this.anchorRow;r<=maxR;r++)for(let c=0;c<this.colsIn(r);c++)if(this.validCell(r,c))candidates.push({r,c,j:this.cellY(r)+this.rnd(0,ROWH*2.2)});
      if(!candidates.length)break;candidates.sort((a,b)=>b.j-a.j);const cell=candidates[(this.random()*Math.min(4,candidates.length))|0];
      this.grid.set(key(cell.r,cell.c),{r:cell.r,c:cell.c,kind:KINDS[(this.random()*KINDS.length)|0],special:null,placedBy:-1});added++;
    }
    this.updateLowest();this.refreshQueues();this.emit('garbage',{fromId,amount:added});return added;
  }
  /* Superlinear so a patient 12-bubble cut beats four hurried 3s: 10/bubble plus a
     quadratic bonus on everything past the minimum match. */
  popPoints(n){ const over=Math.max(0,n-3); return n*10+over*over*10; }
  /* `comps` is how many separate clusters the cut severed at once. Each extra
     simultaneous cluster is worth half again, capped so a lucky shear stays sane. */
  dropPoints(n,comps){ const cascade=Math.min(3,1+0.5*Math.max(0,comps-1)); return Math.round(n*30*cascade)+(n>=5?200:0); }
  countComponents(cells){
    const pool=new Set(cells.map(b=>key(b.r,b.c)));
    let comps=0;
    while(pool.size){
      comps++; const start=pool.values().next().value, stack=[start.split(',').map(Number)]; pool.delete(start);
      while(stack.length){ const [r,c]=stack.pop();
        for(const [nr,nc] of this.neighbors(r,c)){ const k=key(nr,nc); if(pool.has(k)){pool.delete(k);stack.push([nr,nc]);} } }
    }
    return comps;
  }
  /* Solo runs have no second clearer to hand the chain to, so consecutive clears by
     the only player must build the multiplier instead of resetting it. */
  registerClear(i){const c=this.chain,solo=this.players.length<=1;if(solo||c.last!==i){c.mult=Math.min(c.mult+1,4);c.same=0;}else if(++c.same>=3){c.mult=1;c.players.clear();c.same=0;}c.last=i;c.players.add(i);c.t=8;}
  anyDangerCells(){let hit=false;this.grid.forEach(b=>{if(this.cellY(b.r)+R>this.DANGER_Y)hit=true;});return hit;}
  // Puzzle Bobble ceiling descent: the whole pack slides down one row and the
  // wall stagger alternates. Bumping r and parityFlip together leaves par(r) —
  // and therefore cellX — invariant, so nothing shifts sideways. Dropping
  // gridTop by ROWH at the same instant cancels the jump, and the existing
  // gridTop -> gridTopTarget easing plays the slide out over ~0.6s.
  descendRow(){
    const ng=new Map();this.grid.forEach(b=>{b.r++;ng.set(key(b.r,b.c),b);});this.grid=ng;
    this.parityFlip^=1;this.anchorRow++;this.gridTop-=ROWH;
    this.updateLowest();this.refreshQueues();
  }
  shotsPerDrop(){
    const base=this.settings.pressureShots;
    return base?Math.max(3,base-(KINDS.length-this.availKinds().length)):0;
  }
  addRow(){const moved=new Map();this.grid.forEach(b=>{b.r++;moved.set(key(b.r,b.c),b);});this.grid=moved;this.parityFlip^=1;const a=this.anchorRow;for(let c=0;c<this.colsIn(a);c++)if(this.random()<.85)this.grid.set(key(a,c),{r:a,c,kind:KINDS[(this.random()*4)|0],special:null,placedBy:-1});this.updateLowest();this.refreshQueues();this.emit('ceiling');}
  end(won){if(this.state!=='play')return;this.state=won?'won':'lost';this.emit(won?'win':'lose',{score:this.score});}
  setPaused(value){if(this.state==='play'){this.paused=!!value;this.emit(this.paused?'paused':'resumed');}}

  snapshot() {
    return {
      tick:this.tickId, state:this.paused?'paused':this.state, now:this.now, settings:this.settings,
      WW:this.WW, cols:this.cols, parityFlip:this.parityFlip, anchorRow:this.anchorRow,
      gridTop:this.gridTop, gridTopTarget:this.gridTopTarget, pressure:this.pressure, perDrop:this.shotsPerDrop(),
      lowestY:this.lowestY, grid:[...this.grid.values()], flights:this.flights,
      players:this.players.map(p=>({...p,held:undefined})), score:this.score, dispScore:this.dispScore,
      missMeter:this.missMeter, danger:this.danger, chain:{...this.chain,players:[...this.chain.players]},
      events:this.events.slice(-32), eventId:this.eventId,
    };
  }
  snapshotFor(){return this.snapshot();}
}

module.exports = { OnlineGame, LEVELS, clamp, geom, normalizeViewH: vh => geom(vh).H };
