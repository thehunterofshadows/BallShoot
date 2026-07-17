/* Bubble Together — cooperative multiplayer bubble-shooter prototype.
   Architecture: central authoritative state (grid, flights, queues, timers, meters)
   updated in update(); rendering fully separate in render(). Each player is an
   independent input stream (pointer / key-pair / bot controller) feeding fire()/aim —
   ready to be replaced by WebSocket streams later. */
(() => {
if (customElements.get('coop-bubbles')) return;

const W = 640, H = 1080, R = 28, COLS = 11;
const ROWH = R * Math.sqrt(3), X0 = 12, GRIDTOP0 = 108, DANGER_Y = 846, LAUNCH_Y = 938;
const PAL  = { R:'#ff5b6b', Y:'#ffc233', G:'#3ecf72', B:'#3f9dff' };
const PALD = { R:'#d13a4c', Y:'#d69a12', G:'#1fa557', B:'#2273cc' };
const KINDS = ['R','Y','G','B'];
/* Level library — rows alternate 11/10 wide; even rows anchor to the ceiling.
   Designed on Puzzle Bobble principles: readable clusters, big payoffs for cutting
   narrow supports, bank-shot channels, and setups one player leaves for another. */
const LEVELS = [
  { name:"The Vault", rows:[ // scattered singles weave — build your own matches; grind open the high arch
    "GGBYRGBYYGB",
    "BRRGBYRGBY",
    "RGGYRGBYRGB",
    "BYRBBYRGBY",
    "RGBYYGBYRGB",
    "BYRGBYRGBY",
    "RGBY...YRGB",
    "BYRG...GBY",
    "RGB.....RGB",
    "BY.......Y",
  ]},
  { name:"Chandeliers", rows:[ // dense field, three solid pendants: pop direct or cut the cells above
    "YYRBGYRBBYR",
    "RGGYRBGYRB",
    "GYYBGYRBGYR",
    "RBGRRBGYRB",
    "GYRBBYRBGYR",
    "RBGYRBGYRB",
    "GYRBGYRBGYR",
    "BB.RR...BB",
    "BB.RR....BB",
  ]},
  { name:"The Canyon", rows:[ // 11-row wall towers; coordinated cuts drop big chunks
    "RRYGBRYGGRY",
    "YBBRYGBRYG",
    "BRRGBRYGBRY",
    "YGBYYGBRYG",
    "BRYGGRYGBRY",
    "YGBR...RYG",
    "BRYG...GBRY",
    "YGBR...RYG",
    "BRYG...GBRY",
    "YGB.....YG",
    "BR.......RY",
  ]},
  { name:"Hive Bridge", rows:[ // right hive hangs from a lone 2-bubble bridge up the center channel
    "YBGRY......",
    "GRYBGG....",
    "YBGRY.BRYBG",
    "GRYB..YBGR",
    "YBGRR.GRYBG",
    "GRYB..YBGR",
    "YBGRY.RRYBG",
    "GRYB..YGGR",
    "BBGRY.GRRBG",
    "GYYB..YBGR",
  ]},
];
const META = [
  { name:'P1', accent:'#ff6fb1', trail:'solid', icon:'tri',    ctrl:'On-screen \u25c0 \u25b6 + FIRE (click or hold)' },
  { name:'P2', accent:'#a78bfa', trail:'dots',  icon:'square', ctrl:'A / D aim · W or Space fire' },
  { name:'P3', accent:'#35d3c8', trail:'rings', icon:'ring',   ctrl:'← / → aim · ↑ or Enter fire' },
  { name:'P4', accent:'#ffb054', trail:'spark', icon:'star',   ctrl:'J / L aim · K fire' },
];
const SFX = { // sound-event hooks: name -> [freq, dur, type, slide]
  launch:[540,.07,'triangle',-120], bounce:[300,.05,'sine',60], attach:[220,.06,'sine',0],
  pop:[660,.12,'triangle',240], bigpop:[520,.22,'triangle',380], drop:[160,.35,'sawtooth',-90],
  chain:[880,.14,'triangle',220], warn:[240,.3,'square',-60], rescue:[720,.4,'triangle',300],
  win:[620,.6,'triangle',400], lose:[220,.7,'sawtooth',-140], swap:[430,.08,'sine',120], ceiling:[190,.3,'square',-50],
};
const key = (r,c) => r + ',' + c;
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const rnd = (a,b) => a + Math.random() * (b - a);

class CoopBubbles extends HTMLElement {
  connectedCallback() {
    if (this._init) return; this._init = true;
    this.settings = { players:4, human:[true,false,false,false], botSkill:'normal',
      reload:1.35, missMax:12, rescueDur:4, assist:0.35, mateLines:true, sound:true, mode:'clear', field:'classic', guide:1, level:0 };
    this.buildDOM();
    this.resetGame();
    this.state = 'tutorial';
    this.bindInput();
    this._raf = requestAnimationFrame(t => this.frame(t));
  }
  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
    this._unbind && this._unbind();
  }

  /* ---------- state / setup ---------- */
  resetGame() {
    this.WW = this.settings.field === 'wide' ? W * 4 : W;
    this.cols = Math.floor((this.WW - 2 * X0) / (2 * R));
    this.grid = new Map(); this.parityFlip = 0;
    this.gridTop = GRIDTOP0; this.gridTopTarget = GRIDTOP0;
    const rows = this.levelRows();
    const offs = this.settings.field === 'wide' ? [1, 12, 23, 34] : [0];
    for (const off of offs) rows.forEach((row, r) => { for (let i = 0; i < row.length; i++) {
      const c = i + off;
      if (row[i] !== '.') this.grid.set(key(r,c), { r, c, kind: row[i], special: null, placedBy: -1 });
    }});
    // quietly purge any unsupported bubbles (bad custom levels)
    const safe0 = new Set(), st0 = [];
    this.grid.forEach((b,k) => { if (b.r === 0) { safe0.add(k); st0.push(b); } });
    while (st0.length) { const b = st0.pop();
      for (const [nr,nc] of this.neighbors(b.r,b.c)) { const k = key(nr,nc), nb = this.grid.get(k);
        if (nb && !safe0.has(k)) { safe0.add(k); st0.push(nb); } } }
    [...this.grid.keys()].forEach(k => { if (!safe0.has(k)) this.grid.delete(k); });
    this.flights = []; this.falling = []; this.fx = []; this.pops = []; this.callouts = []; this.sfxLog = [];
    this.sparks = []; this.ripples = []; this.dispScore = 0;
    this.batch = []; this.resolveAt = 0; this.shotCount = 0; this.specialFlip = 0; this.specialWho = 0;
    this.score = 0; this.missMeter = 0; this.danger = null; this.shake = 0; this.now = 0;
    this.chain = { mult:1, last:-1, same:0, players:new Set(), t:0 };
    this.rowTimer = 0; this.lowestY = 0;
    this.spawnPlayers();
    const pf0 = this.players[this.activeP] || this.players[0];
    this.camX = clamp(pf0.x - W / 2, 0, Math.max(0, this.WW - W));
    this.updateLowest();
    if (this.state !== 'tutorial') this.state = 'play';
    this.hideOverlays();
  }
  spawnPlayers() {
    const n = this.settings.players, keep = this.players || [];
    this.players = [];
    for (let i = 0; i < n; i++) {
      const x = this.WW * (i + 0.5) / n;
      const old = keep[i];
      this.players.push({ i, meta: META[i], x, angle: old ? old.angle : rnd(-0.3,0.3),
        cur: this.genBubble(), next: this.genBubble(), reload: 0,
        bot: !this.settings.human[i], think: rnd(0.4,1.2), plan: null, held: {},
        stats: { shots:0, pops:0, bubbles:0, assists:0, drops:0, rescues:0 } });
    }
    this.activeP = this.players.findIndex(p => !p.bot); if (this.activeP < 0) this.activeP = 0;
  }
  levelRows() {
    if (this.settings.level === 'custom') {
      let t = this.customText;
      if (t === undefined) { try { t = localStorage.getItem('bt_custom_level') || ''; } catch(e) { t = ''; } }
      const rows = t.split('\n').map(s => s.trim().toUpperCase().replace(/[^RGYB.]/g, '.')).filter(s => s.length)
        .slice(0, 12).map((s, r) => { const n = (r % 2) ? 10 : 11; return (s + '.'.repeat(n)).slice(0, n); });
      if (rows.some(s => /[RGYB]/.test(s))) return rows;
    }
    const L = LEVELS[this.settings.level];
    return (L || LEVELS[0]).rows;
  }
  availKinds() {
    const s = new Set();
    this.grid.forEach(b => { if (!b.special) s.add(b.kind); });
    this.flights.forEach(f => { if (!f.special) s.add(f.kind); });
    return s.size ? [...s] : ['R'];
  }
  genBubble() {
    this.shotCount++;
    if (this.shotCount > 6 && this.shotCount % 11 === 0) {
      const sp = (this.specialFlip++ % 2) ? 'bomb' : 'rainbow';
      return { kind:'R', special: sp };
    }
    const av = this.availKinds();
    return { kind: av[(Math.random() * av.length) | 0], special: null };
  }
  refreshQueues() { // replace queued colors that vanished from the field
    const av = new Set(this.availKinds());
    this.players.forEach(p => ['cur','next'].forEach(slot => {
      const b = p[slot];
      if (b && !b.special && !av.has(b.kind)) {
        b.kind = [...av][(Math.random() * av.size) | 0]; b.swapT = this.now; this.sfx('swap');
      }
    }));
  }

  /* ---------- grid helpers ---------- */
  par(r) { return (r + this.parityFlip) & 1; }
  colsIn(r) { return this.par(r) ? this.cols - 1 : this.cols; }
  cellX(r,c) { return X0 + R + c * 2 * R + this.par(r) * R; }
  cellY(r) { return this.gridTop + R + r * ROWH; }
  neighbors(r,c) {
    const p = this.par(r), a = c - 1 + p, b = c + p;
    return [[r,c-1],[r,c+1],[r-1,a],[r-1,b],[r+1,a],[r+1,b]];
  }
  validCell(r,c) {
    if (c < 0 || c >= this.colsIn(r) || r < 0 || this.grid.has(key(r,c))) return false;
    if (r === 0) return true;
    return this.neighbors(r,c).some(([nr,nc]) => this.grid.has(key(nr,nc)));
  }
  updateLowest() {
    let m = 0; this.grid.forEach(b => { const y = this.cellY(b.r); if (y > m) m = y; });
    this.lowestY = m;
  }
  snapCell(x,y) {
    const rr = Math.max(0, Math.round((y - this.gridTop - R) / ROWH));
    for (const span of [2, 5]) {
      let best = null, bd = 1e18;
      for (let r = Math.max(0, rr - span); r <= rr + span; r++) {
        const n = this.colsIn(r);
        for (let c = 0; c < n; c++) {
          if (!this.validCell(r,c)) continue;
          const d = (this.cellX(r,c) - x) ** 2 + (this.cellY(r) - y) ** 2;
          if (d < bd) { bd = d; best = { r, c }; }
        }
      }
      if (best) return best;
    }
    return null;
  }
  hypoSize(r,c,kind) { // group size if a bubble of `kind` were placed at r,c
    const seen = new Set([key(r,c)]), st = [[r,c]];
    let n = 1;
    while (st.length) {
      const [cr,cc] = st.pop();
      for (const [nr,nc] of this.neighbors(cr,cc)) {
        const k = key(nr,nc); if (seen.has(k)) continue;
        const b = this.grid.get(k);
        if (b && (b.kind === kind || b.special === 'rainbow')) { seen.add(k); n++; st.push([nr,nc]); }
      }
    }
    return n;
  }
  matchGroup(r,c,kind) {
    const seen = new Set([key(r,c)]), st = [[r,c]];
    while (st.length) {
      const [cr,cc] = st.pop();
      for (const [nr,nc] of this.neighbors(cr,cc)) {
        const k = key(nr,nc); if (seen.has(k)) continue;
        const b = this.grid.get(k);
        if (b && (b.kind === kind || b.special === 'rainbow')) { seen.add(k); st.push([nr,nc]); }
      }
    }
    return seen;
  }

  /* ---------- shooting / flight ---------- */
  fire(i) {
    const p = this.players[i];
    if (this.state !== 'play' || p.reload > 0) return;
    const a = clamp(p.angle, -1.22, 1.22);
    const sx = p.x, sy = LAUNCH_Y - 44, sp = 1150;
    this.flights.push({ p: i, x: sx, y: sy, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp,
      kind: p.cur.kind, special: p.cur.special, trail: [], bounceCd: 0 });
    p.cur = p.next; p.next = this.genBubble();
    p.reload = this.settings.reload; p.stats.shots++; p.recoilT = this.now;
    for (let s = 0; s < 5; s++) this.sparks.push({ x: sx + Math.sin(a) * 34, y: sy - Math.cos(a) * 34,
      vx: Math.sin(a) * rnd(60, 180) + rnd(-40, 40), vy: -Math.cos(a) * rnd(60, 180) + rnd(-40, 40),
      g: 0, t: this.now, life: 0.35, color: 'rgba(255,255,255,0.85)', sz: rnd(4, 8), soft: true });
    this.sfx('launch');
  }
  simulate(x0, angle) { // shared by aim guides + bots
    let x = x0, y = LAUNCH_Y - 44, bounces = 0;
    const st = 7, dx = Math.sin(angle) * st, dy = -Math.cos(angle) * st;
    let vx = dx; const pts = [{x,y}], bpts = [];
    for (let i = 0; i < 420; i++) {
      x += vx; y += dy;
      if (x < X0 + R) { x = 2 * (X0 + R) - x; vx = -vx; bounces++; bpts.push({x:X0+R, y}); }
      if (x > this.WW - X0 - R) { x = 2 * (this.WW - X0 - R) - x; vx = -vx; bounces++; bpts.push({x:this.WW-X0-R, y}); }
      if ((i & 1) === 0) pts.push({x,y});
      if (y <= this.gridTop + R) return { pts, bpts, bounces, cell: this.snapCell(x,y) };
      if (y < this.lowestY + 2.2 * R && this.hitGrid(x,y)) return { pts, bpts, bounces, cell: this.snapCell(x,y) };
    }
    return { pts, bpts, bounces, cell: null };
  }
  hitGrid(x,y) {
    const rr = Math.round((y - this.gridTop - R) / ROWH), lim = (2 * R * 0.88) ** 2;
    for (let r = Math.max(0, rr - 1); r <= rr + 1; r++) {
      const n = this.colsIn(r);
      for (let c = 0; c < n; c++) {
        if (!this.grid.has(key(r,c))) continue;
        if ((this.cellX(r,c) - x) ** 2 + (this.cellY(r) - y) ** 2 < lim) return true;
      }
    }
    return false;
  }
  stepFlights(dt) {
    const lim = 2 * R * 0.88;
    for (let fi = this.flights.length - 1; fi >= 0; fi--) {
      const f = this.flights[fi];
      f.trail.push({ x: f.x, y: f.y }); if (f.trail.length > 16) f.trail.shift();
      f.bounceCd -= dt;
      let dist = Math.hypot(f.vx, f.vy) * dt, landed = false;
      while (dist > 0 && !landed) {
        const step = Math.min(dist, R * 0.45); dist -= step;
        const m = step / Math.hypot(f.vx, f.vy);
        f.x += f.vx * m; f.y += f.vy * m;
        if (f.x < X0 + R) { f.x = 2*(X0+R) - f.x; f.vx = -f.vx; if (f.bounceCd <= 0) { this.sfx('bounce'); f.bounceCd = .1; } }
        if (f.x > this.WW - X0 - R) { f.x = 2*(this.WW-X0-R) - f.x; f.vx = -f.vx; if (f.bounceCd <= 0) { this.sfx('bounce'); f.bounceCd = .1; } }
        if (f.y <= this.gridTop + R || (f.y < this.lowestY + 2.2*R && this.hitGrid(f.x, f.y))) landed = true;
      }
      if (landed) { this.flights.splice(fi, 1); this.land(f); }
      else if (f.y > H + 60) this.flights.splice(fi, 1);
    }
  }
  land(f) {
    let cell = this.snapCell(f.x, f.y);
    if (!cell) return; // no space at all — vanish gracefully (practically unreachable)
    // placement assistance: nudge into a match-completing neighbor cell
    if (!f.special && this.settings.assist > 0 && this.hypoSize(cell.r, cell.c, f.kind) < 3) {
      for (const [nr,nc] of this.neighbors(cell.r, cell.c)) {
        if (!this.validCell(nr,nc)) continue;
        const d = Math.hypot(this.cellX(nr,nc) - f.x, this.cellY(nr) - f.y);
        if (d < 2.7 * R && this.hypoSize(nr,nc,f.kind) >= 3 && Math.random() < this.settings.assist) { cell = { r:nr, c:nc }; break; }
      }
    }
    const b = { r: cell.r, c: cell.c, kind: f.kind, special: f.special, placedBy: f.p,
      snapFrom: { x: f.x, y: f.y }, snapT: this.now };
    this.grid.set(key(cell.r, cell.c), b);
    this.ripples.push({ x: this.cellX(cell.r, cell.c), y: this.cellY(cell.r), t: this.now });
    this.batch.push(b);
    if (!this.resolveAt) this.resolveAt = this.now + 0.2; // generous simultaneous-landing window
    this.updateLowest();
    this.sfx('attach');
  }

  /* ---------- batch resolution ---------- */
  resolveBatch() {
    const landed = this.batch; this.batch = []; this.resolveAt = 0;
    const results = []; // {shooter, popped:Set|null}
    for (const b of landed) {
      if (!this.grid.get(key(b.r, b.c))) { results.push({ shooter: b.placedBy, popped: null, gone: true }); continue; }
      if (b.special === 'bomb') {
        const bx = this.cellX(b.r, b.c), by = this.cellY(b.r), blast = new Set([key(b.r,b.c)]);
        this.grid.forEach((g,k) => { if (Math.hypot(this.cellX(g.r,g.c) - bx, this.cellY(g.r) - by) <= R * 4.3) blast.add(k); });
        results.push({ shooter: b.placedBy, popped: blast, bomb: true });
      } else {
        let kind = b.kind;
        if (b.special === 'rainbow') { // adopt the biggest adjacent color group
          let best = null, bs = 0;
          for (const [nr,nc] of this.neighbors(b.r,b.c)) {
            const nb = this.grid.get(key(nr,nc));
            if (nb && !nb.special) { const s = this.matchGroup(b.r, b.c, nb.kind).size; if (s > bs) { bs = s; best = nb.kind; } }
          }
          if (best) kind = best; else { results.push({ shooter: b.placedBy, popped: null }); continue; }
        }
        const g = this.matchGroup(b.r, b.c, kind);
        results.push({ shooter: b.placedBy, popped: g.size >= 3 ? g : null });
      }
    }
    // pop everything, collect owners
    const allPopped = new Set(); let popN = 0; const owners = new Set(); const clearers = [];
    for (const r of results) {
      if (!r.popped) continue;
      let fresh = 0;
      r.popped.forEach(k => { if (!allPopped.has(k) && this.grid.has(k)) {
        const b = this.grid.get(k);
        if (b.placedBy >= 0 && b.placedBy !== r.shooter) owners.add(b.placedBy);
        allPopped.add(k); fresh++;
      }});
      if (fresh > 0) clearers.push(r.shooter);
      popN += fresh;
    }
    allPopped.forEach(k => {
      const b = this.grid.get(k); this.grid.delete(k);
      this.pops.push({ x: this.cellX(b.r,b.c), y: this.cellY(b.r), kind: b.kind, special: b.special, t: this.now,
        parts: Array.from({ length: 8 }, () => ({ a: rnd(0, 6.28), sp: rnd(100, 320), sz: rnd(3, 6.5) })) });
    });
    // unsupported drop check
    const dropped = this.supportCheck();
    this.updateLowest();
    // scoring / chain / meters
    if (popN > 0) {
      clearers.forEach(s => this.registerClear(s));
      const mult = this.chain.mult;
      const pts = popN * 10 * mult;
      this.score += pts; this.addPopup(this.centerOf(allPopped, this.pops), '+' + pts, '#17335c');
      clearers.forEach(s => { const p = this.players[s]; if (p) { p.stats.pops++; p.stats.bubbles += popN; } });
      owners.forEach(o => { const p = this.players[o]; if (p) p.stats.assists++; });
      if (owners.size >= 1) this.callout(owners.size + clearers.length >= 3 ? 'TEAM POP!' : 'ASSIST!', '#a78bfa');
      this.missMeter = Math.max(0, this.missMeter - 1);
      this.sfx(popN >= 6 ? 'bigpop' : 'pop');
      if (results.some(r => r.bomb && r.popped)) this.callout('KABOOM!', '#ff8a3c');
    }
    // misses: every landed shot that didn't pop counts one miss (per spec), even if a teammate popped in the same batch
    let misses = 0;
    for (const r of results) if (!r.popped && !r.gone && !r.bomb) misses++;
    if (misses) {
      this.missMeter += misses;
      if (this.missMeter >= this.settings.missMax * 0.6) { this.chain.mult = 1; this.chain.players.clear(); }
      if (this.missMeter >= this.settings.missMax) this.ceilingDescend();
    }
    // drops
    if (dropped.n > 0) {
      const pts = dropped.n * 30 * this.chain.mult + (dropped.n >= 5 ? 200 : 0);
      this.score += pts;
      clearers.forEach(s => { const p = this.players[s]; if (p) p.stats.drops += dropped.n; });
      this.addPopup({ x: dropped.x, y: dropped.y }, '+' + pts, '#ff8a3c');
      if (dropped.comps >= 2) this.callout('DOUBLE CUT!', '#35d3c8');
      else if (dropped.n >= 5) this.callout('HUGE DROP!', '#ff8a3c');
      this.missMeter = dropped.n >= 8 ? 0 : Math.max(0, this.missMeter - 3);
      this.shake = Math.min(14, 4 + dropped.n * 1.2);
      this.sfx('drop');
    }
    // rescue?
    if (this.danger && !this.anyDangerCells()) {
      this.danger = null; this.score += 500; this.missMeter = Math.max(0, this.missMeter - 3);
      clearers.forEach(s => { const p = this.players[s]; if (p) p.stats.rescues++; });
      this.callout('TEAM RESCUE! +500', '#3ecf72'); this.sfx('rescue');
    }
    this.refreshQueues();
    // victory (coop clear)
    if (this.settings.mode === 'clear' && this.grid.size === 0 && this.state === 'play') this.endGame(true);
  }
  supportCheck() {
    const safe = new Set(), st = [];
    this.grid.forEach((b,k) => { if (b.r === 0) { safe.add(k); st.push(b); } });
    while (st.length) {
      const b = st.pop();
      for (const [nr,nc] of this.neighbors(b.r,b.c)) {
        const k = key(nr,nc), nb = this.grid.get(k);
        if (nb && !safe.has(k)) { safe.add(k); st.push(nb); }
      }
    }
    const doomed = [];
    this.grid.forEach((b,k) => { if (!safe.has(k)) doomed.push([k,b]); });
    if (!doomed.length) return { n: 0 };
    // connected components among the fallen (for Double Cut)
    const dset = new Set(doomed.map(d => d[0])); let comps = 0; const seen = new Set();
    for (const [k,b] of doomed) {
      if (seen.has(k)) continue; comps++; const q = [b]; seen.add(k);
      while (q.length) { const cur = q.pop();
        for (const [nr,nc] of this.neighbors(cur.r,cur.c)) { const nk = key(nr,nc);
          if (dset.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(this.grid.get(nk)); } } }
    }
    let sx = 0, sy = 0;
    for (const [k,b] of doomed) {
      const x = this.cellX(b.r,b.c), y = this.cellY(b.r); sx += x; sy += y;
      this.grid.delete(k);
      this.falling.push({ x, y, vx: rnd(-60,60), vy: rnd(-140,-40), kind: b.kind, special: b.special, spin: rnd(-3,3), a: 0 });
    }
    return { n: doomed.length, comps, x: sx / doomed.length, y: sy / doomed.length };
  }
  registerClear(pi) {
    const ch = this.chain;
    if (ch.last !== pi) { ch.mult = Math.min(ch.mult + 1, 4); ch.same = 0; ch.pulseT = this.now; }
    else if (++ch.same >= 3) { ch.mult = 1; ch.players.clear(); ch.same = 0; }
    ch.last = pi; ch.players.add(pi); ch.t = 8;
    if (ch.mult >= 2) {
      if (ch.players.size >= 4) { this.callout('FOUR-PLAYER BURST!', '#ff6fb1'); this.score += 400; ch.players.clear(); }
      else if (ch.players.size === 3) this.callout('THREE-PLAYER CHAIN!', '#35d3c8');
      else this.callout('TEAM CHAIN ×' + ch.mult, '#a78bfa');
      this.sfx('chain');
    }
  }
  centerOf(keys) {
    let sx = 0, sy = 0, n = 0;
    keys.forEach(k => { const [r,c] = k.split(',').map(Number); sx += this.cellX(r,c); sy += this.cellY(r); n++; });
    return n ? { x: sx/n, y: sy/n } : { x: W/2, y: 300 };
  }
  ceilingDescend() {
    this.missMeter = 0; this.gridTopTarget += ROWH;
    this.callout('CEILING DROPS!', '#ff5b6b'); this.sfx('ceiling'); this.shake = 8;
  }
  addRow() { // endless survival: push a new row in at the top
    const ng = new Map();
    this.grid.forEach(b => { b.r += 1; ng.set(key(b.r,b.c), b); });
    this.grid = ng; this.parityFlip ^= 1;
    const n = this.colsIn(0), av = KINDS;
    for (let c = 0; c < n; c++) if (Math.random() < 0.85)
      this.grid.set(key(0,c), { r:0, c, kind: av[(Math.random()*av.length)|0], special: null, placedBy: -1 });
    this.updateLowest(); this.refreshQueues(); this.sfx('ceiling');
  }
  anyDangerCells() {
    let hit = false;
    this.grid.forEach(b => { if (this.cellY(b.r) + R > DANGER_Y) hit = true; });
    return hit;
  }
  endGame(won) {
    this.state = won ? 'won' : 'lost';
    this.sfx(won ? 'win' : 'lose');
    this.showEnd(won);
  }

  /* ---------- bots ---------- */
  botUpdate(p, dt) {
    p.think -= dt;
    if (!p.plan && p.reload <= 0 && p.think <= 0) {
      this.botPlan(p);
      const d = { relaxed: 3.2, normal: 2.2, skilled: 1.3 }[this.settings.botSkill];
      p.think = d + rnd(0, d * 0.7);
    }
    if (p.plan) {
      const diff = p.plan.angle - p.angle;
      p.angle += clamp(diff, -2.6 * dt, 2.6 * dt);
      if (Math.abs(diff) < 0.015 && p.reload <= 0) { this.fire(p.i); p.plan = null; }
    }
  }
  botPlan(p) {
    const mateKinds = this.players.filter(q => q !== p && q.cur && !q.cur.special).map(q => q.cur.kind);
    const cand = [];
    for (let a = -1.15; a <= 1.151; a += 0.055) {
      const sim = this.simulate(p.x, a);
      if (!sim.cell) continue;
      cand.push({ a, s: this.botScore(sim.cell, p.cur, sim.bounces, mateKinds) });
    }
    if (!cand.length) { p.plan = null; return; }
    cand.sort((u,v) => v.s - u.s);
    const sk = this.settings.botSkill;
    let pick = cand[0];
    if (sk === 'relaxed' && Math.random() < 0.45) pick = cand[Math.min(cand.length - 1, (Math.random()*6)|0)];
    else if (sk === 'normal' && Math.random() < 0.3) pick = cand[Math.min(cand.length - 1, (Math.random()*3)|0)];
    const err = sk === 'skilled' ? 0.02 : sk === 'normal' ? 0.05 : 0.085;
    p.plan = { angle: clamp(pick.a + rnd(-err, err), -1.22, 1.22) };
  }
  botScore(cell, bub, bounces, mateKinds) {
    let s = rnd(0, 5);
    if (bub.special === 'bomb') {
      const bx = this.cellX(cell.r,cell.c), by = this.cellY(cell.r); let n = 0;
      this.grid.forEach(g => { if (Math.hypot(this.cellX(g.r,g.c)-bx, this.cellY(g.r)-by) <= R*4.3) n++; });
      s = 20 + n * 14;
    } else {
      let kind = bub.kind;
      if (bub.special === 'rainbow') { // rainbows: aim at any decent cluster
        let bs = 0;
        for (const [nr,nc] of this.neighbors(cell.r,cell.c)) { const nb = this.grid.get(key(nr,nc));
          if (nb && !nb.special) { const g = this.hypoSize(cell.r,cell.c,nb.kind); if (g > bs) { bs = g; kind = nb.kind; } } }
      }
      const g = this.hypoSize(cell.r, cell.c, kind);
      if (g >= 3) {
        s = 120 + g * 15;
        if (this.danger) { // does this pop reach the endangered zone?
          const grp = this.matchGroup(cell.r, cell.c, kind);
          let low = 0; grp.forEach(k => { const [r] = k.split(',').map(Number); low = Math.max(low, this.cellY(r)); });
          if (low + R > DANGER_Y - ROWH * 1.5) s += 900;
        }
      } else if (g === 2) s = 34;
      else {
        // setting up: adjacent same-color singles, or seeding next to a teammate's color
        let mates = 0;
        for (const [nr,nc] of this.neighbors(cell.r,cell.c)) { const nb = this.grid.get(key(nr,nc));
          if (nb && mateKinds.includes(nb.kind) && nb.kind === kind) mates++; }
        s = 8 + mates * 22;
      }
      s -= cell.r * 1.4; // don't build downward for no reason
    }
    if (bounces > 0) s += 6;
    return s;
  }

  /* ---------- update loop ---------- */
  frame(t) {
    this._raf = requestAnimationFrame(tt => this.frame(tt));
    const dt = Math.min(0.033, (t - (this._t || t)) / 1000); this._t = t;
    if (this.state === 'play') this.update(dt);
    this.render();
  }
  update(rdt) {
    const ts = this.danger ? 0.55 : 1; // dramatic slow-mo during rescue window
    const dt = rdt * ts;
    this.now += rdt;
    this.gridTop += clamp(this.gridTopTarget - this.gridTop, -80*rdt, 80*rdt);
    // player input streams
    for (const p of this.players) {
      p.reload = Math.max(0, p.reload - dt);
      if (p.bot) this.botUpdate(p, dt);
      else {
        const spd = 2.4 * rdt;
        if (p.held.l) { p.angle = clamp(p.angle - spd, -1.22, 1.22); this.activeP = p.i; }
        if (p.held.r) { p.angle = clamp(p.angle + spd, -1.22, 1.22); this.activeP = p.i; }
      }
    }
    // camera follows the active player's aim (wide field)
    const pf = this.players[this.activeP] || this.players[0];
    const camT = clamp(pf.x + Math.sin(pf.angle) * 420 - W / 2, 0, Math.max(0, this.WW - W));
    this.camX += (camT - this.camX) * Math.min(1, 6 * rdt);
    this.stepFlights(dt);
    if (this.resolveAt && this.now >= this.resolveAt) this.resolveBatch();
    // falling bubbles (bounce once on the floor edge, splash, fade)
    const FLOOR = 92 + LAUNCH_Y - 60 - R + 6;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.vy += 1900 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.a += f.spin * dt;
      if (f.y > FLOOR && f.vy > 0) {
        f.b = (f.b || 0) + 1; f.y = FLOOR; f.vy *= -0.45; f.vx *= 0.75; f.spin *= 0.6;
        for (let s = 0; s < 6; s++) this.sparks.push({ x: f.x + rnd(-8, 8), y: FLOOR + R * 0.7,
          vx: rnd(-140, 140), vy: rnd(-260, -60), g: 1500, t: this.now, life: 0.5,
          color: PAL[f.kind] || '#fff', sz: rnd(2.5, 5) });
      }
      if (f.b >= 2) f.fade = (f.fade !== undefined ? f.fade : 1) - 3 * dt;
      if ((f.fade !== undefined && f.fade <= 0) || f.y > H + 60) this.falling.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.vy += (s.g || 0) * dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (this.now - s.t > s.life) this.sparks.splice(i, 1);
    }
    this.dispScore += (this.score - this.dispScore) * Math.min(1, 10 * rdt);
    // chain timer
    if (this.chain.t > 0) { this.chain.t -= rdt; if (this.chain.t <= 0) { this.chain.mult = 1; this.chain.players.clear(); this.chain.last = -1; } }
    // danger / rescue (real time)
    const inDanger = this.anyDangerCells();
    if (inDanger && !this.danger) { this.danger = { t: this.settings.rescueDur, max: this.settings.rescueDur }; this.callout('DANGER! CLEAR THE LINE!', '#ff5b6b'); this.sfx('warn'); }
    else if (!inDanger && this.danger) { this.danger = null; }
    if (this.danger) { this.danger.t -= rdt; if (this.danger.t <= 0) return this.endGame(false); }
    // endless rows
    if (this.settings.mode === 'endless') {
      this.rowTimer += rdt;
      const interval = Math.max(10, 24 - this.now / 30);
      if (this.rowTimer > interval && !this.resolveAt) { this.rowTimer = 0; this.addRow(); }
      if (this.grid.size === 0) { this.addRow(); this.addRow(); }
    }
    this.shake = Math.max(0, this.shake - 40 * rdt);
    this.fxTick();
  }
  fxTick() {
    this.pops = this.pops.filter(p => this.now - p.t < 0.62);
    this.ripples = this.ripples.filter(r => this.now - r.t < 0.45);
    this.callouts = this.callouts.filter(c => this.now - c.t < 1.5);
    this.popups = (this.popups || []).filter(p => this.now - p.t < 1.1);
    this.sfxLog = this.sfxLog.filter(s => this.now - s.t < 1.6);
  }
  callout(text, color) { this.callouts.push({ text, color, t: this.now }); }
  addPopup(pos, text, color) { (this.popups = this.popups || []).push({ x: pos.x, y: pos.y, text, color, t: this.now }); }

  /* ---------- audio hooks ---------- */
  sfx(name) {
    this.sfxLog.push({ name, t: this.now });
    if (!this.settings.sound || !this._ac) return;
    const def = SFX[name]; if (!def) return;
    const [f, d, type, slide] = def, ac = this._ac;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, ac.currentTime);
    o.frequency.linearRampToValueAtTime(Math.max(40, f + slide), ac.currentTime + d);
    g.gain.setValueAtTime(0.12, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + d);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + d + 0.02);
  }
  ensureAudio() {
    if (!this._ac) { try { this._ac = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {} }
    if (this._ac && this._ac.state === 'suspended') this._ac.resume();
  }

  /* ---------- input ---------- */
  bindInput() {
    this.canvas.addEventListener('pointerdown', () => this.ensureAudio());
    const keymap = { // player input streams by key
      a:[1,'l'], d:[1,'r'], arrowleft:[2,'l'], arrowright:[2,'r'], j:[3,'l'], l:[3,'r'],
    };
    const firemap = { w:1, ' ':1, arrowup:2, enter:2, k:3 };
    const kd = e => {
      if (/input|select|textarea/i.test(e.target.tagName)) return;
      this.ensureAudio();
      const k = e.key.toLowerCase();
      if (k === 'p') { this.togglePause(); return; }
      const am = keymap[k];
      if (am) { const p = this.players[am[0]]; if (p && !p.bot) { p.held[am[1]] = true; e.preventDefault(); } }
      if (firemap[k] !== undefined) { const p = this.players[firemap[k]]; if (p && !p.bot) { this.fire(firemap[k]); e.preventDefault(); } }
    };
    const ku = e => { const am = keymap[e.key.toLowerCase()];
      if (am) { const p = this.players[am[0]]; if (p) p.held[am[1]] = false; } };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this._unbind = () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }
  togglePause() {
    if (this.state === 'play') { this.state = 'paused'; this.pauseEl.style.display = 'grid'; }
    else if (this.state === 'paused') { this.state = 'play'; this.pauseEl.style.display = 'none'; this._t = performance.now(); }
    this.syncButtons();
  }

  /* ---------- rendering ---------- */
  render() {
    const ctx = this.ctx; if (!ctx) return;
    const sc = this.canvas.width / W;
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    if (this.shake > 0) ctx.translate(rnd(-this.shake, this.shake) * 0.4, rnd(-this.shake, this.shake) * 0.4);
    // background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#eaf4ff'); bg.addColorStop(1, '#d8ecff');
    ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.save(); ctx.translate(-this.camX, 0);
    const vwL = this.camX - 2 * R, vwR = this.camX + W + 2 * R;
    // field panel
    ctx.fillStyle = '#f9fcff';
    this.rrect(ctx, X0 - 6, 92, this.WW - 2 * (X0 - 6), LAUNCH_Y - 60, 26); ctx.fill();
    ctx.strokeStyle = '#c4ddf5'; ctx.lineWidth = 3; ctx.stroke();
    // honeycomb ghost grid
    ctx.save(); ctx.beginPath();
    this.rrect(ctx, X0 - 6, 92, this.WW - 2 * (X0 - 6), LAUNCH_Y - 60, 26); ctx.clip();
    // parallax backdrop bubbles
    for (let i = 0; i < 12; i++) {
      let px = (i * 173.3 - this.camX * 0.45) % (W + 160); if (px < 0) px += W + 160;
      px += this.camX - 80;
      const py = 960 - ((i * 97 + this.now * (14 + (i % 5) * 7)) % 860);
      const pr = 14 + (i % 4) * 12;
      ctx.fillStyle = 'rgba(120,170,220,0.06)';
      ctx.beginPath(); ctx.arc(px, py, pr, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(120,170,220,0.05)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, 7); ctx.stroke();
    }
    // wall inner shadows
    let sg = ctx.createLinearGradient(X0 - 6, 0, X0 + 26, 0);
    sg.addColorStop(0, 'rgba(60,100,150,0.14)'); sg.addColorStop(1, 'rgba(60,100,150,0)');
    ctx.fillStyle = sg; ctx.fillRect(X0 - 6, 92, 32, LAUNCH_Y - 60);
    sg = ctx.createLinearGradient(this.WW - X0 + 6, 0, this.WW - X0 - 26, 0);
    sg.addColorStop(0, 'rgba(60,100,150,0.14)'); sg.addColorStop(1, 'rgba(60,100,150,0)');
    ctx.fillStyle = sg; ctx.fillRect(this.WW - X0 - 26, 92, 32, LAUNCH_Y - 60);
    ctx.strokeStyle = 'rgba(90,140,190,0.10)'; ctx.lineWidth = 1.4;
    const maxR = Math.ceil((DANGER_Y - this.gridTop) / ROWH);
    for (let r = 0; r <= maxR; r++) {
      const n = this.colsIn(r);
      for (let c = 0; c < n; c++) {
        const gx = this.cellX(r,c); if (gx < vwL || gx > vwR) continue;
        ctx.beginPath(); ctx.arc(gx, this.cellY(r), R - 5, 0, 7); ctx.stroke();
      }
    }
    ctx.restore();
    // ceiling
    const cg = ctx.createLinearGradient(0, 60, 0, this.gridTop);
    cg.addColorStop(0, '#9fc4e8'); cg.addColorStop(1, '#b9d7f2');
    ctx.fillStyle = cg; ctx.fillRect(X0 - 6, 60, this.WW - 2*(X0-6), this.gridTop - 60);
    ctx.strokeStyle = '#8fb6dd'; ctx.lineWidth = 2;
    const hx0 = Math.floor(Math.max(X0, this.camX) / 26) * 26;
    for (let x = hx0; x < Math.min(this.WW - X0, this.camX + W); x += 26) {
      ctx.beginPath(); ctx.moveTo(x, this.gridTop - 3); ctx.lineTo(x + 12, this.gridTop - 16); ctx.stroke();
    }
    ctx.fillStyle = '#7ba7d1'; ctx.fillRect(X0 - 6, this.gridTop - 4, this.WW - 2*(X0-6), 4);
    const tg = ctx.createLinearGradient(0, this.gridTop, 0, this.gridTop + 22);
    tg.addColorStop(0, 'rgba(60,100,150,0.16)'); tg.addColorStop(1, 'rgba(60,100,150,0)');
    ctx.fillStyle = tg; ctx.fillRect(X0 - 6, this.gridTop, this.WW - 2*(X0-6), 22);
    // attached bubbles
    this.grid.forEach(b => {
      let x = this.cellX(b.r,b.c), y = this.cellY(b.r);
      if (x < vwL || x > vwR) return;
      if (b.snapFrom) {
        const k = clamp((this.now - b.snapT) / 0.14, 0, 1), e = 1 - (1-k)*(1-k);
        x = b.snapFrom.x + (x - b.snapFrom.x) * e; y = b.snapFrom.y + (y - b.snapFrom.y) * e;
        if (k >= 1) delete b.snapFrom;
      }
      let s = 1 + Math.sin(this.now * 2 + b.r * 1.7 + b.c * 2.3) * 0.014; // idle breathe
      if (b.snapT !== undefined) { const kk = (this.now - b.snapT) / 0.32;
        if (kk < 1) s += Math.sin(kk * Math.PI * 2.5) * 0.16 * (1 - kk); }
      for (const rp of this.ripples) { // impact jiggle ripples to neighbors
        const d = Math.hypot(x - rp.x, y - rp.y);
        if (d > 1 && d < R * 3.2) { const kk = (this.now - rp.t) / 0.45;
          const amp = (1 - kk) * 3.5 * (1 - d / (R * 3.2));
          x += (x - rp.x) / d * amp * Math.sin(kk * 14); y += (y - rp.y) / d * amp * Math.sin(kk * 14); }
      }
      const dangerB = this.danger && this.cellY(b.r) + R > DANGER_Y;
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      this.drawBubble(ctx, 0, 0, R - 1, b.kind, b.special, true, dangerB);
      ctx.restore();
    });
    // danger line + rescue drama
    this.drawDanger(ctx);
    // falling
    for (const f of this.falling) {
      ctx.save(); ctx.globalAlpha = f.fade !== undefined ? Math.max(0, f.fade) : 1;
      ctx.translate(f.x, f.y); ctx.rotate(f.a);
      this.drawBubble(ctx, 0, 0, R - 1, f.kind, f.special, false, false);
      ctx.restore();
    }
    // pop fx
    for (const p of this.pops) {
      const k = (this.now - p.t) / 0.62, col = p.special ? '#fff' : PAL[p.kind];
      if (k < 0.18) { ctx.globalAlpha = (1 - k / 0.18) * 0.9; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, R * (0.9 + k * 2), 0, 7); ctx.fill(); }
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = col; ctx.lineWidth = 7 * (1 - k);
      ctx.beginPath(); ctx.arc(p.x, p.y, R * (0.6 + k * 2.6), 0, 7); ctx.stroke();
      if (p.parts) for (const q of p.parts) {
        const d = q.sp * k * 0.62, gx = p.x + Math.cos(q.a) * d, gy = p.y + Math.sin(q.a) * d + 340 * k * k;
        ctx.fillStyle = col; ctx.globalAlpha = 1 - k;
        ctx.beginPath(); ctx.arc(gx, gy, q.sz * (1 - k), 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    for (const s of this.sparks) {
      const k = (this.now - s.t) / s.life;
      ctx.globalAlpha = Math.max(0, 1 - k) * (s.soft ? 0.5 : 0.9);
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.soft ? s.sz * (1 + k * 2.2) : Math.max(0.5, s.sz * (1 - k * 0.6)), 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // aim guides (under flights)
    if (this.state === 'play' || this.state === 'paused') {
      for (const p of this.players) {
        const isActive = p.i === this.activeP && !p.bot;
        if (!isActive && !this.settings.mateLines) continue;
        if (p.reload > this.settings.reload * 0.65) continue;
        this.drawGuide(ctx, p, isActive ? 0.9 : p.bot ? 0.22 : 0.4);
      }
    }
    // flights + trails
    for (const f of this.flights) { this.drawTrail(ctx, f);
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(Math.atan2(f.vy, f.vx) + Math.PI / 2); ctx.scale(0.92, 1.12);
      this.drawBubble(ctx, 0, 0, R - 1, f.kind, f.special, false, false); ctx.restore(); }
    // launchers
    for (const p of this.players) this.drawLauncher(ctx, p);
    // score popups (world-anchored)
    for (const p of (this.popups || [])) {
      const k = (this.now - p.t) / 1.1;
      ctx.globalAlpha = 1 - k; ctx.fillStyle = p.color;
      ctx.font = '700 30px Fredoka, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y - k * 46); ctx.globalAlpha = 1;
    }
    ctx.restore();
    // vignette + rescue drama (screen space)
    const vg = ctx.createRadialGradient(W/2, H/2, H*0.35, W/2, H/2, H*0.75);
    vg.addColorStop(0, 'rgba(40,70,120,0)'); vg.addColorStop(1, 'rgba(40,70,120,0.10)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (this.danger && this.state === 'play') {
      ctx.fillStyle = 'rgba(140,160,200,0.10)'; ctx.fillRect(0, 0, W, H);
      const dp = 0.22 + Math.sin(this.now * 8) * 0.12;
      const eg = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.72);
      eg.addColorStop(0, 'rgba(255,91,107,0)'); eg.addColorStop(1, 'rgba(255,91,107,' + dp.toFixed(3) + ')');
      ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
    }
    // HUD
    this.drawHUD(ctx);
    this.callouts.forEach((c, idx) => {
      const k = (this.now - c.t) / 1.5, pop = Math.min(1, k * 6);
      ctx.save(); ctx.translate(W/2, 320 + idx * 56); ctx.scale(0.6 + pop * 0.4, 0.6 + pop * 0.4);
      ctx.globalAlpha = Math.min(1, (1 - k) * 3);
      ctx.font = '700 44px Fredoka, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.strokeText(c.text, 0, 0);
      ctx.fillStyle = c.color; ctx.fillText(c.text, 0, 0);
      ctx.restore(); ctx.globalAlpha = 1;
    });
    ctx.font = '600 15px ui-monospace, monospace'; ctx.textAlign = 'left';
    this.sfxLog.slice(-3).forEach((s, i) => {
      ctx.globalAlpha = Math.max(0, 1 - (this.now - s.t) / 1.6) * 0.55;
      ctx.fillStyle = '#3a5a80'; ctx.fillText('\u266a ' + s.name, X0 + 6, LAUNCH_Y - 78 - i * 20);
    });
    ctx.globalAlpha = 1;
  }
  rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  drawBubble(ctx, x, y, rad, kind, special, face, dangerPulse) {
    if (special === 'rainbow') {
      const spin = this.now * 1.5;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = PAL[KINDS[i]];
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.arc(x, y, rad, spin + i * Math.PI/2, spin + (i+1) * Math.PI/2); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(x, y, rad * 0.45, 0, 7); ctx.fill();
      ctx.fillStyle = '#17335c'; ctx.font = '700 ' + (rad) + 'px Fredoka, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('\u2605', x, y + 1);
      ctx.textBaseline = 'alphabetic';
    } else if (special === 'bomb') {
      const g = ctx.createRadialGradient(x - rad*0.4, y - rad*0.4, 2, x, y, rad);
      g.addColorStop(0, '#6b7a93'); g.addColorStop(1, '#2c3a52');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
      ctx.strokeStyle = '#ffb054'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + rad*0.3, y - rad*0.8); ctx.quadraticCurveTo(x + rad*0.9, y - rad*1.3, x + rad*0.5, y - rad*1.5); ctx.stroke();
      const fl = 2 + Math.sin(this.now * 14) * 1.5;
      ctx.fillStyle = '#ffd54a'; ctx.beginPath(); ctx.arc(x + rad*0.5, y - rad*1.5, fl, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 ' + (rad*0.9) + 'px Fredoka, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('\u2736', x, y + 1); ctx.textBaseline = 'alphabetic';
    } else {
      ctx.fillStyle = 'rgba(30,60,110,0.13)';
      ctx.beginPath(); ctx.ellipse(x + rad*0.1, y + rad*0.55, rad*0.85, rad*0.55, 0, 0, 7); ctx.fill();
      const g = ctx.createRadialGradient(x - rad*0.35, y - rad*0.45, rad*0.08, x, y, rad);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.22, PAL[kind]); g.addColorStop(0.85, PALD[kind]); g.addColorStop(1, PALD[kind]);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = rad*0.12;
      ctx.beginPath(); ctx.arc(x, y, rad*0.86, Math.PI*0.15, Math.PI*0.7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.ellipse(x - rad*0.34, y - rad*0.42, rad*0.26, rad*0.16, -0.6, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(x + rad*0.3, y - rad*0.5, rad*0.09, 0, 7); ctx.fill();
      // bottom-right shading crescent (arcade-sphere depth)
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, 7);
      ctx.arc(x - rad*0.16, y - rad*0.2, rad*0.94, 0, 7);
      ctx.fillStyle = 'rgba(25,45,90,0.22)'; ctx.fill('evenodd');
      // dark outline ring for crisp arcade read
      ctx.strokeStyle = 'rgba(25,45,90,0.28)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, rad - 0.8, 0, 7); ctx.stroke();
    }
    if (dangerPulse) {
      ctx.globalAlpha = 0.5 + Math.sin(this.now * 9) * 0.4;
      ctx.strokeStyle = '#ff5b6b'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, rad + 4, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  drawTrail(ctx, f) {
    const meta = META[f.p], n = f.trail.length;
    for (let i = 0; i < n; i++) {
      const pt = f.trail[i], a = (i / n) * 0.7;
      ctx.globalAlpha = a; ctx.fillStyle = meta.accent; ctx.strokeStyle = meta.accent;
      if (meta.trail === 'solid' && i > 0) {
        ctx.lineWidth = 3 + (i/n) * 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(f.trail[i-1].x, f.trail[i-1].y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
      } else if (meta.trail === 'dots') {
        if (i % 2 === 0) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 2 + (i/n)*4, 0, 7); ctx.fill(); }
      } else if (meta.trail === 'rings') {
        if (i % 3 === 0) { ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pt.x, pt.y, 3 + (i/n)*8, 0, 7); ctx.stroke(); }
      } else {
        if (i % 2 === 0) { const s = 2.5 + (i/n)*4; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(pt.x - s, pt.y); ctx.lineTo(pt.x + s, pt.y);
          ctx.moveTo(pt.x, pt.y - s); ctx.lineTo(pt.x, pt.y + s); ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;
  }
  drawGuide(ctx, p, alpha) {
    const sim = this.simulate(p.x, clamp(p.angle, -1.22, 1.22));
    const meta = p.meta;
    const frac = this.settings.guide;
    const pts = frac >= 1 ? sim.pts : sim.pts.slice(0, Math.max(2, Math.ceil(sim.pts.length * frac)));
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = meta.accent; ctx.fillStyle = meta.accent;
    if (meta.trail === 'solid') {
      ctx.lineWidth = 3; ctx.setLineDash([]);
      ctx.beginPath(); pts.forEach((q,i) => i ? ctx.lineTo(q.x,q.y) : ctx.moveTo(q.x,q.y)); ctx.stroke();
    } else if (meta.trail === 'dots') {
      ctx.setLineDash([2, 14]); ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach((q,i) => i ? ctx.lineTo(q.x,q.y) : ctx.moveTo(q.x,q.y)); ctx.stroke(); ctx.setLineDash([]);
    } else if (meta.trail === 'rings') {
      for (let i = 4; i < pts.length; i += 5) { ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 5, 0, 7); ctx.stroke(); }
    } else {
      for (let i = 3; i < pts.length; i += 4) { const q = pts[i]; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(q.x-4,q.y); ctx.lineTo(q.x+4,q.y); ctx.moveTo(q.x,q.y-4); ctx.lineTo(q.x,q.y+4); ctx.stroke(); }
    }
    if (frac >= 1) for (const b of sim.bpts) { // first-bounce markers
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, 7, 0, 7); ctx.stroke();
    }
    if (frac >= 1 && sim.cell) { // predicted landing ghost
      const x = this.cellX(sim.cell.r, sim.cell.c), y = this.cellY(sim.cell.r);
      ctx.setLineDash([6, 6]); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, R - 3, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      if (!p.cur.special) { ctx.globalAlpha = alpha * 0.3; ctx.fillStyle = PAL[p.cur.kind];
        ctx.beginPath(); ctx.arc(x, y, R - 6, 0, 7); ctx.fill(); }
    }
    ctx.restore();
  }
  drawLauncher(ctx, p) {
    const x = p.x, y = LAUNCH_Y, meta = p.meta;
    const rk = p.recoilT !== undefined ? clamp((this.now - p.recoilT) / 0.18, 0, 1) : 1;
    const rec = (1 - rk) * 7, aa = clamp(p.angle, -1.22, 1.22);
    const ox = -Math.sin(aa) * rec, oy = Math.cos(aa) * rec;
    // base shadow
    ctx.fillStyle = 'rgba(30,60,110,0.16)';
    ctx.beginPath(); ctx.ellipse(x, y - 28, 44, 13, 0, 0, 7); ctx.fill();
    // barrel
    ctx.save(); ctx.translate(x + ox, y - 44 + oy); ctx.rotate(aa);
    const bg2 = ctx.createLinearGradient(-13, 0, 13, 0);
    bg2.addColorStop(0, '#c9def4'); bg2.addColorStop(0.5, '#f2f8ff'); bg2.addColorStop(1, '#c9def4');
    ctx.fillStyle = bg2; ctx.strokeStyle = meta.accent; ctx.lineWidth = 3;
    this.rrect(ctx, -13, -54, 26, 42, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = meta.accent; this.rrect(ctx, -13, -54, 26, 9, 5); ctx.fill();
    ctx.restore();
    // glossy pod
    const pg = ctx.createRadialGradient(x - 12 + ox, y - 58 + oy, 4, x + ox, y - 44 + oy, 38);
    pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.7, '#eef6ff'); pg.addColorStop(1, '#d3e5f7');
    ctx.fillStyle = pg; ctx.strokeStyle = meta.accent; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x + ox, y - 44 + oy, 34, 0, 7); ctx.fill(); ctx.stroke();
    // reload arc
    if (p.reload > 0) {
      const k = 1 - p.reload / this.settings.reload;
      ctx.strokeStyle = meta.accent; ctx.lineWidth = 5; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(x, y - 44, 40, -Math.PI/2, -Math.PI/2 + k * 6.283); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // current bubble in pod (dim while reloading)
    ctx.globalAlpha = p.reload > 0 ? 0.45 : 1;
    const pulse = p.cur.swapT && this.now - p.cur.swapT < 0.5 ? 1 + Math.sin((this.now - p.cur.swapT) * 20) * 0.12 : 1;
    this.drawBubble(ctx, x + ox, y - 44 + oy, 22 * pulse, p.cur.kind, p.cur.special, false, false);
    ctx.globalAlpha = 1;
    // glass dome gloss
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(x + ox - 8, y - 58 + oy, 16, 9, -0.5, 0, 7); ctx.fill();
    // next preview
    this.drawBubble(ctx, x + 40, y + 6, 13, p.next.kind, p.next.special, false, false);
    ctx.font = '600 12px Fredoka, sans-serif'; ctx.fillStyle = '#7593b5'; ctx.textAlign = 'center';
    ctx.fillText('next', x + 40, y + 34);
    // identity icon + label
    ctx.fillStyle = meta.accent; ctx.strokeStyle = meta.accent;
    const iy = y + 12;
    ctx.lineWidth = 3;
    if (meta.icon === 'tri') { ctx.beginPath(); ctx.moveTo(x, iy - 9); ctx.lineTo(x + 9, iy + 7); ctx.lineTo(x - 9, iy + 7); ctx.closePath(); ctx.fill(); }
    else if (meta.icon === 'square') { this.rrect(ctx, x - 8, iy - 8, 16, 16, 4); ctx.fill(); }
    else if (meta.icon === 'ring') { ctx.beginPath(); ctx.arc(x, iy, 8, 0, 7); ctx.stroke(); }
    else { for (let i = 0; i < 4; i++) { const a = i * Math.PI/2 + Math.PI/4;
      ctx.beginPath(); ctx.moveTo(x, iy); ctx.lineTo(x + Math.cos(a)*10, iy + Math.sin(a)*10); ctx.stroke(); } }
    ctx.font = '700 16px Fredoka, sans-serif'; ctx.fillStyle = '#2b4a70';
    ctx.fillText(meta.name + (p.bot ? ' \u00b7 bot' : ''), x, y + 44);
  }
  drawDanger(ctx) {
    ctx.setLineDash([12, 10]); ctx.lineWidth = 3;
    ctx.strokeStyle = this.danger ? '#ff5b6b' : 'rgba(255,91,107,0.45)';
    ctx.beginPath(); ctx.moveTo(X0, DANGER_Y); ctx.lineTo(this.WW - X0, DANGER_Y); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '600 14px Fredoka, sans-serif'; ctx.fillStyle = 'rgba(255,91,107,0.7)'; ctx.textAlign = 'right';
    ctx.fillText('danger line', this.camX + W - X0 - 8, DANGER_Y - 8);
    if (this.danger) {
      const pulse = 0.10 + Math.sin(this.now * 8) * 0.07;
      ctx.fillStyle = 'rgba(255,91,107,' + pulse + ')';
      ctx.fillRect(X0 - 6, DANGER_Y - ROWH * 1.6, this.WW - 2*(X0-6), ROWH * 1.6);
      // countdown
      const t = Math.max(0, this.danger.t), cx0 = this.camX + W / 2;
      ctx.textAlign = 'center';
      ctx.font = '700 84px Fredoka, sans-serif';
      ctx.lineWidth = 10; ctx.strokeStyle = '#fff';
      ctx.strokeText(t.toFixed(1), cx0, DANGER_Y - 60);
      ctx.fillStyle = '#ff5b6b'; ctx.fillText(t.toFixed(1), cx0, DANGER_Y - 60);
      ctx.font = '600 22px Fredoka, sans-serif';
      ctx.lineWidth = 6; ctx.strokeText('CLEAR THE GLOWING BUBBLES!', cx0, DANGER_Y - 20);
      ctx.fillText('CLEAR THE GLOWING BUBBLES!', cx0, DANGER_Y - 20);
    }
  }
  drawHUD(ctx) {
    ctx.textAlign = 'left';
    const mw = 170, mx = W - X0 - 10 - mw, my = 34;
    ctx.save(); ctx.shadowColor = 'rgba(40,80,140,0.18)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    this.rrect(ctx, X0, 10, 190, 64, 16); ctx.fill();
    this.rrect(ctx, mx - 12, 10, mw + 24, 64, 16); ctx.fill();
    ctx.restore();
    ctx.font = '700 32px Fredoka, sans-serif'; ctx.fillStyle = '#17335c';
    ctx.fillText(Math.round(this.dispScore || 0).toLocaleString(), X0 + 14, 46);
    ctx.font = '600 13px Fredoka, sans-serif'; ctx.fillStyle = '#7593b5';
    ctx.fillText('TEAM SCORE', X0 + 14, 65);
    // chain badge
    ctx.textAlign = 'center';
    if (this.chain.mult > 1) {
      const k = clamp(this.chain.t / 8, 0, 1);
      const pk = this.chain.pulseT !== undefined ? clamp((this.now - this.chain.pulseT) / 0.35, 0, 1) : 1;
      const s = 1 + (1 - pk) * 0.22;
      ctx.save(); ctx.translate(W/2, 40); ctx.scale(s, s);
      ctx.shadowColor = 'rgba(120,90,220,0.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#a78bfa';
      this.rrect(ctx, -74, -24, 148, 46, 23); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.fillStyle = '#fff'; ctx.font = '700 24px Fredoka, sans-serif';
      ctx.fillText('CHAIN \u00d7' + this.chain.mult, 0, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(-60, 15, 120 * k, 3);
      ctx.restore();
    } else {
      ctx.fillStyle = '#9db8d4'; ctx.font = '600 17px Fredoka, sans-serif';
      ctx.fillText(this.settings.mode === 'clear' ? 'clear the field together!' : 'endless survival', W/2, 42);
    }
    // miss meter (secondary)
    ctx.textAlign = 'right'; ctx.font = '600 13px Fredoka, sans-serif'; ctx.fillStyle = '#7593b5';
    ctx.fillText('MISS METER \u2192 ceiling drops', W - X0 - 14, my - 6);
    ctx.fillStyle = '#e3eefa'; this.rrect(ctx, mx, my, mw, 14, 7); ctx.fill();
    const frac = clamp(this.missMeter / this.settings.missMax, 0, 1);
    if (frac > 0) {
      ctx.fillStyle = frac > 0.7 ? '#ff5b6b' : frac > 0.4 ? '#ffb054' : '#8fb6dd';
      this.rrect(ctx, mx, my, Math.max(10, mw * frac), 14, 7); ctx.fill();
    }
    for (let i = 1; i < this.settings.missMax; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(mx + mw * i / this.settings.missMax, my + 2, 1.5, 10);
    }
  }

  /* ---------- DOM / UI ---------- */
  buildDOM() {
    const sh = this.attachShadow({ mode: 'open' });
    sh.innerHTML = `
<style>
:host{display:block;width:100%;height:100%;font-family:'Fredoka',sans-serif;color:#17335c}
*{box-sizing:border-box}
.root{display:flex;width:100%;height:100%;background:linear-gradient(#dbedff,#cfe6ff);justify-content:center;gap:20px;padding:14px;overflow:hidden}
.gameCol{position:relative;height:100%;aspect-ratio:640/1080;max-width:100%}
canvas{width:100%;height:100%;display:block;border-radius:22px;box-shadow:0 12px 40px rgba(40,80,140,.18);touch-action:none}
.pad{position:absolute;left:50%;transform:translateX(-50%);bottom:4px;display:flex;gap:10px;z-index:4}
.pad button{border:0;border-radius:12px;background:rgba(255,255,255,.94);box-shadow:0 4px 14px rgba(40,80,140,.25);font:inherit;font-weight:700;color:#2b4a70;cursor:pointer;padding:7px 20px;font-size:17px;touch-action:none;user-select:none;-webkit-user-select:none}
.pad button:active{background:#2b6fd4;color:#fff}
.pad .padF{background:#ff6fb1;color:#fff;font-size:14px;letter-spacing:.06em}
.side{width:290px;flex:none;height:100%;overflow-y:auto;background:#fff;border-radius:20px;padding:18px;box-shadow:0 8px 30px rgba(40,80,140,.12);font-size:14px}
.side h3{margin:14px 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#7593b5}
.side h2{margin:0 0 4px;font-size:20px}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0}
.seg{display:flex;gap:4px}
.lvlSeg{flex-wrap:wrap}
textarea{width:100%;font:12px ui-monospace,monospace;border:2px solid #d7e6f5;border-radius:10px;padding:8px;resize:vertical;color:#2b4a70;background:#f8fbff;letter-spacing:2px}
details summary{cursor:pointer;color:#2b4a70;font-weight:600;margin-top:8px;font-size:13px}
.seg button{border:2px solid #d7e6f5;background:#f4f9ff;border-radius:10px;padding:5px 10px;font:inherit;font-size:13px;cursor:pointer;color:#2b4a70}
.seg button.on{background:#2b6fd4;border-color:#2b6fd4;color:#fff}
input[type=range]{width:130px;accent-color:#2b6fd4}
.val{width:44px;text-align:right;color:#7593b5;font-size:12px}
.btn{width:100%;border:0;border-radius:12px;padding:10px;font:inherit;font-weight:600;cursor:pointer;margin-top:8px}
.btn.primary{background:#2b6fd4;color:#fff}
.btn.ghost{background:#eef5fd;color:#2b4a70}
.pRow{display:flex;align-items:center;gap:8px;margin:6px 0}
.pDot{width:14px;height:14px;border-radius:50%;flex:none}
.pName{width:26px;font-weight:600}
.ctrlList{margin:4px 0 0;padding:0;list-style:none;color:#5b7997;font-size:12.5px;line-height:1.5}
.ctrlList b{color:#2b4a70}
.overlay{position:absolute;inset:0;display:grid;place-items:center;border-radius:22px;background:rgba(23,51,92,.45);backdrop-filter:blur(3px);z-index:5}
.card{background:#fff;border-radius:24px;padding:26px 28px;width:min(480px,88%);max-height:92%;overflow-y:auto;box-shadow:0 20px 60px rgba(20,40,80,.35)}
.card h1{margin:0 0 2px;font-size:30px}
.card .sub{color:#7593b5;margin:0 0 16px;font-size:15px}
.tut{display:flex;gap:12px;align-items:flex-start;margin:11px 0}
.tut .n{flex:none;width:30px;height:30px;border-radius:50%;background:#2b6fd4;color:#fff;display:grid;place-items:center;font-weight:700;font-size:15px}
.tut p{margin:3px 0 0;font-size:15px;line-height:1.35}
.tut b{color:#2b6fd4}
.gear{position:absolute;top:10px;right:10px;z-index:4;width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(40,80,140,.25);font-size:20px;cursor:pointer;display:none}
.statRow{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:#f4f9ff;margin:6px 0;font-size:14px}
.statRow .who{font-weight:700;width:34px}
.statRow .nums{color:#5b7997;font-size:12.5px}
@media (max-width:900px){ .side{display:none} .gear{display:block}
 .side.open{display:block;position:absolute;right:8px;top:60px;bottom:8px;z-index:6;width:min(300px,80%)} }
</style>
<div class="root">
  <div class="gameCol">
    <canvas></canvas>
    <button class="gear" title="settings">\u2699</button>
    <div class="pad"><button class="padL">\u25c0</button><button class="padF">FIRE</button><button class="padR">\u25b6</button></div>
    <div class="overlay tutorial"><div class="card">
      <h1>Bubble Together</h1>
      <p class="sub">Co-op bubble shooter \u00b7 2\u20134 players \u00b7 one shared field</p>
      <div class="tut"><div class="n">1</div><p><b>Aim &amp; shoot.</b> P1: on-screen \u25c0 \u25b6 + FIRE buttons. P2: A/D + Space. P3: arrows + Enter. P4: J/L + K.</p></div>
      <div class="tut"><div class="n">2</div><p><b>Match 3+</b> bubbles of the same color to pop them.</p></div>
      <div class="tut"><div class="n">3</div><p>Bubbles cut off from the ceiling <b>fall</b> \u2014 big drops score big.</p></div>
      <div class="tut"><div class="n">4</div><p><b>Everyone shares the same field</b> \u2014 set up matches for each other for Assists and Team Chains.</p></div>
      <div class="tut"><div class="n">5</div><p>Flying shots <b>pass through</b> each other \u2014 fire whenever you're ready.</p></div>
      <div class="tut"><div class="n">6</div><p>If bubbles cross the <b>danger line</b>, clear them before the rescue timer hits zero!</p></div>
      <button class="btn primary start">Start playing</button>
    </div></div>
    <div class="overlay pause" style="display:none"><div class="card" style="text-align:center">
      <h1>Paused</h1><p class="sub">press P or the button to resume</p>
      <button class="btn primary resume">Resume</button>
    </div></div>
    <div class="overlay end" style="display:none"><div class="card">
      <h1 class="endTitle"></h1><p class="sub endSub"></p>
      <div class="endStats"></div>
      <button class="btn primary again">Play again</button>
    </div></div>
  </div>
  <div class="side"></div>
</div>`;
    this.canvas = sh.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tutEl = sh.querySelector('.tutorial');
    this.pauseEl = sh.querySelector('.pause');
    this.endEl = sh.querySelector('.end');
    this.sideEl = sh.querySelector('.side');
    sh.querySelector('.start').onclick = () => { this.ensureAudio(); this.state = 'play'; this._t = performance.now(); this.tutEl.style.display = 'none'; };
    sh.querySelector('.resume').onclick = () => this.togglePause();
    sh.querySelector('.again').onclick = () => { this.state = 'play'; this.resetGame(); };
    sh.querySelector('.gear').onclick = () => this.sideEl.classList.toggle('open');
    const firstHuman = () => this.players.find(q => !q.bot);
    const wireHold = (sel, dir) => { const b = sh.querySelector(sel);
      b.addEventListener('pointerdown', e => { e.preventDefault(); this.ensureAudio();
        const p = firstHuman(); if (p) { b._p = p; p.held[dir] = true; this.activeP = p.i; } });
      const off = () => { if (b._p) { b._p.held[dir] = false; b._p = null; } };
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    };
    wireHold('.padL', 'l'); wireHold('.padR', 'r');
    sh.querySelector('.padF').addEventListener('pointerdown', e => { e.preventDefault(); this.ensureAudio();
      const p = firstHuman(); if (p) { this.activeP = p.i; this.fire(p.i); } });
    const ro = new ResizeObserver(() => this.fit());
    ro.observe(sh.querySelector('.gameCol'));
    this.fit();
    this.buildSettings();
  }
  fit() {
    const el = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth || 320;
    el.width = Math.round(w * dpr); el.height = Math.round(w * dpr * H / W);
  }
  hideOverlays() { this.pauseEl.style.display = 'none'; this.endEl.style.display = 'none'; }
  showEnd(won) {
    const sh = this.shadowRoot;
    sh.querySelector('.endTitle').textContent = won ? '\u2b50 Field cleared!' : 'The bubbles won\u2026';
    sh.querySelector('.endTitle').style.color = won ? '#2b6fd4' : '#ff5b6b';
    sh.querySelector('.endSub').textContent = 'Team score: ' + this.score.toLocaleString();
    sh.querySelector('.endStats').innerHTML = this.players.map(p =>
      `<div class="statRow"><span class="who" style="color:${p.meta.accent}">${p.meta.name}</span>
       <span class="nums">${p.stats.pops} pops \u00b7 ${p.stats.bubbles} bubbles \u00b7 ${p.stats.assists} assists \u00b7 ${p.stats.drops} dropped \u00b7 ${p.stats.rescues} rescues</span></div>`).join('');
    this.endEl.style.display = 'grid';
  }
  buildSettings() {
    const S = this.settings, el = this.sideEl;
    el.innerHTML = `
<h2>Bubble Together</h2>
<div style="color:#7593b5;font-size:13px">co-op prototype settings</div>
<h3>Mode</h3><div class="seg modeSeg">
  <button data-m="clear">Co-op Clear</button><button data-m="endless">Endless</button></div>
<h3>Field</h3><div class="seg fldSeg">
  <button data-f="classic">Classic</button><button data-f="wide">Wide 4\u00d7</button></div>
<div style="color:#9db8d4;font-size:12px;margin-top:2px">wide: the camera pans as you aim</div>
<h3>Level</h3>
<div class="seg lvlSeg">${LEVELS.map((L, i) => `<button data-lv="${i}">${i + 1}. ${L.name}</button>`).join('')}<button data-lv="custom">Custom</button></div>
<details><summary>Custom level editor</summary>
  <div style="color:#9db8d4;font-size:12px;margin:6px 0">One row per line \u00b7 R G Y B, dot = empty \u00b7 rows alternate 11 / 10 wide \u00b7 floaters are removed</div>
  <textarea class="lvlTxt" rows="7" spellcheck="false"></textarea>
  <button class="btn ghost playCustom">Save &amp; play custom</button>
</details>
<h3>Players</h3>
<div class="seg cntSeg"><button data-n="2">2</button><button data-n="3">3</button><button data-n="4">4</button></div>
<div class="pList"></div>
<div class="row"><span>Bot difficulty</span><div class="seg botSeg">
  <button data-b="relaxed">Relaxed</button><button data-b="normal">Normal</button><button data-b="skilled">Skilled</button></div></div>
<h3>Tuning</h3>
<div class="row"><span>Reload</span><input type="range" class="rl" min="0.8" max="2.2" step="0.05"><span class="val rlv"></span></div>
<div class="row"><span>Miss limit</span><input type="range" class="mm" min="4" max="20" step="1"><span class="val mmv"></span></div>
<div class="row"><span>Rescue timer</span><input type="range" class="rc" min="3" max="5" step="0.5"><span class="val rcv"></span></div>
<div class="row"><span>Aim assist</span><input type="range" class="aa" min="0" max="1" step="0.05"><span class="val aav"></span></div>
<div class="row"><span>Aim guide</span><div class="seg glSeg">
  <button data-g="1">Full</button><button data-g="0.5">50%</button><button data-g="0.25">25%</button></div></div>
<div class="row"><span>Teammate lines</span><div class="seg tlSeg"><button data-v="1">Show</button><button data-v="0">Hide</button></div></div>
<div class="row"><span>Sound</span><div class="seg sndSeg"><button data-v="1">On</button><button data-v="0">Off</button></div></div>
<button class="btn ghost pauseBtn">Pause (P)</button>
<button class="btn ghost resetBtn">Reset stage</button>
<button class="btn ghost howBtn">How to play</button>
<h3>Controls</h3>
<ul class="ctrlList">${META.map(m => `<li><b style="color:${m.accent}">${m.name}</b> \u2014 ${m.ctrl}</li>`).join('')}</ul>`;
    const segWire = (sel, get, set) => el.querySelectorAll(sel + ' button').forEach(b => {
      b.onclick = () => { set(b); syncAll(); };
    });
    const syncAll = () => {
      el.querySelectorAll('.modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === S.mode));
      el.querySelectorAll('.fldSeg button').forEach(b => b.classList.toggle('on', b.dataset.f === S.field));
      el.querySelectorAll('.cntSeg button').forEach(b => b.classList.toggle('on', +b.dataset.n === S.players));
      el.querySelectorAll('.botSeg button').forEach(b => b.classList.toggle('on', b.dataset.b === S.botSkill));
      el.querySelectorAll('.tlSeg button').forEach(b => b.classList.toggle('on', (+b.dataset.v === 1) === S.mateLines));
      el.querySelectorAll('.glSeg button').forEach(b => b.classList.toggle('on', +b.dataset.g === S.guide));
      el.querySelectorAll('.sndSeg button').forEach(b => b.classList.toggle('on', (+b.dataset.v === 1) === S.sound));
      el.querySelectorAll('.lvlSeg button').forEach(b => {
        const v = b.dataset.lv === 'custom' ? 'custom' : +b.dataset.lv;
        b.classList.toggle('on', v === S.level);
      });
      el.querySelector('.rl').value = S.reload; el.querySelector('.rlv').textContent = S.reload.toFixed(2) + 's';
      el.querySelector('.mm').value = S.missMax; el.querySelector('.mmv').textContent = S.missMax;
      el.querySelector('.rc').value = S.rescueDur; el.querySelector('.rcv').textContent = S.rescueDur.toFixed(1) + 's';
      el.querySelector('.aa').value = S.assist; el.querySelector('.aav').textContent = Math.round(S.assist * 100) + '%';
      const pl = el.querySelector('.pList');
      pl.innerHTML = '';
      for (let i = 0; i < S.players; i++) {
        const row = document.createElement('div'); row.className = 'pRow';
        row.innerHTML = `<span class="pDot" style="background:${META[i].accent}"></span><span class="pName">${META[i].name}</span>
          <div class="seg"><button data-h="1">Human</button><button data-h="0">Bot</button></div>`;
        row.querySelectorAll('button').forEach(b => {
          b.classList.toggle('on', (+b.dataset.h === 1) === S.human[i]);
          b.onclick = () => { S.human[i] = +b.dataset.h === 1;
            const p = this.players[i]; if (p) { p.bot = !S.human[i]; p.plan = null; }
            this.activeP = this.players.findIndex(q => !q.bot); if (this.activeP < 0) this.activeP = 0;
            syncAll(); };
        });
        pl.appendChild(row);
      }
      this.syncButtons();
    };
    segWire('.modeSeg', null, b => { S.mode = b.dataset.m; this.resetGame(); });
    segWire('.fldSeg', null, b => { S.field = b.dataset.f; this.resetGame(); });
    el.querySelectorAll('.lvlSeg button').forEach(b => b.onclick = () => {
      S.level = b.dataset.lv === 'custom' ? 'custom' : +b.dataset.lv;
      this.resetGame(); syncAll();
    });
    const ta = el.querySelector('.lvlTxt');
    try { ta.value = localStorage.getItem('bt_custom_level') || 'RRGGBBYYRRG\nR...BB...G\n....YY.....'; } catch(e) {}
    el.querySelector('.playCustom').onclick = () => {
      this.customText = ta.value;
      try { localStorage.setItem('bt_custom_level', ta.value); } catch(e) {}
      S.level = 'custom'; this.resetGame(); syncAll();
    };
    segWire('.cntSeg', null, b => { S.players = +b.dataset.n; S.missMax = 4 + 2 * S.players; this.spawnPlayers(); });
    segWire('.botSeg', null, b => { S.botSkill = b.dataset.b; });
    segWire('.tlSeg', null, b => { S.mateLines = +b.dataset.v === 1; });
    segWire('.glSeg', null, b => { S.guide = +b.dataset.g; });
    segWire('.sndSeg', null, b => { S.sound = +b.dataset.v === 1; if (S.sound) this.ensureAudio(); });
    const slider = (cls, fmt, set) => { const s = el.querySelector(cls);
      s.oninput = () => { set(parseFloat(s.value)); syncAll(); }; };
    slider('.rl', 0, v => S.reload = v);
    slider('.mm', 0, v => S.missMax = v);
    slider('.rc', 0, v => S.rescueDur = v);
    slider('.aa', 0, v => S.assist = v);
    el.querySelector('.pauseBtn').onclick = () => this.togglePause();
    el.querySelector('.resetBtn').onclick = () => { this.state = 'play'; this.resetGame(); };
    el.querySelector('.howBtn').onclick = () => { this.tutEl.style.display = 'grid'; this.state = 'tutorial'; };
    this._syncSettings = syncAll;
    syncAll();
  }
  syncButtons() {
    const b = this.sideEl && this.sideEl.querySelector('.pauseBtn');
    if (b) b.textContent = this.state === 'paused' ? 'Resume (P)' : 'Pause (P)';
  }
}
customElements.define('coop-bubbles', CoopBubbles);
})();
