/* Bubble Together — cooperative and competitive multiplayer bubble shooter.
   Architecture: local authoritative state is updated separately from rendering;
   online rooms consume server-authoritative snapshots. Each player remains an
   independent pointer, key-pair, bot, or WebSocket input stream. */
(() => {
if (customElements.get('coop-bubbles')) return;

/* Stamped by the image build (see Dockerfile). It is substituted before the cache-busting
   hash is taken, so a rebuild always yields a new ?v= and the corner tag on screen always
   names the build the browser actually loaded. Unstamped source runs as "dev". */
const BUILD_STAMP = '__BUILD_STAMP__';
const APP_VERSION = '1.0.0'; // keep in step with package.json
const BUILD_LABEL = 'v' + APP_VERSION + ' · ' + (/^__BUILD/.test(BUILD_STAMP) ? 'dev' : BUILD_STAMP);

const W = 640, R = 28, COLS = 11;
const ROWH = R * Math.sqrt(3), X0 = 12, GRIDTOP0 = 108;
/* The field stays 640 wide and 11 columns so every authored level still fits, but its
   height adapts to the device: tall screens (foldable cover panels, 21:9 phones) get
   real playfield instead of letterbox bars. The launcher and danger line keep their
   historic distance from the floor, so viewH 1080 reproduces the original
   LAUNCH_Y 938 / DANGER_Y 846 exactly. The floor is that original height on purpose —
   a wide screen letterboxes rather than shrinking the world, so no shape ever gets less
   runway than the game already shipped with. */
const H0 = 1080, VIEWH_MIN = H0, VIEWH_MAX = 1560, LAUNCH_GAP = 142, DANGER_GAP = 92;
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
/* P1's touch controls depend on the aim mode, so its hint is filled in from AIM_HINT rather
   than fixed here; the keyboard launchers never change. */
const AIM_HINT = {
  halves: { ctrl:'Touch the lower left / right to aim · FIRE to shoot · ⇄ swap',
    tut:'On mobile, hold the lower-left or lower-right half to aim, then tap FIRE above.' },
  point: { ctrl:'Drag anywhere on the board to aim · FIRE to shoot · ⇄ swap',
    tut:'On mobile, drag anywhere on the board and the cannon swings to your finger, then tap FIRE.' },
};
const META = [
  { name:'P1', accent:'#ff6fb1', trail:'solid', icon:'tri',    ctrl:AIM_HINT.halves.ctrl },
  { name:'P2', accent:'#a78bfa', trail:'dots',  icon:'square', ctrl:'A / D aim · W or Space fire · S swap' },
  { name:'P3', accent:'#35d3c8', trail:'rings', icon:'ring',   ctrl:'← / → aim · ↑ or Enter fire · ↓ swap' },
  { name:'P4', accent:'#ffb054', trail:'spark', icon:'star',   ctrl:'J / L aim · K fire · I swap' },
  { name:'P5', accent:'#5fb7ff', trail:'solid', icon:'tri',    ctrl:'battle royale · bot or online' },
  { name:'P6', accent:'#9ad34d', trail:'dots',  icon:'square', ctrl:'battle royale · bot or online' },
  { name:'P7', accent:'#ff8a75', trail:'rings', icon:'ring',   ctrl:'battle royale · bot or online' },
  { name:'P8', accent:'#d4b45f', trail:'spark', icon:'star',   ctrl:'battle royale · bot or online' },
];
const SFX = { // sound-event hooks: name -> [freq, dur, type, slide]
  launch:[540,.07,'triangle',-120], bounce:[300,.05,'sine',60], attach:[220,.06,'sine',0],
  pop:[660,.12,'triangle',240], bigpop:[520,.22,'triangle',380], drop:[160,.35,'sawtooth',-90],
  chain:[880,.14,'triangle',220], warn:[240,.3,'square',-60], rescue:[720,.4,'triangle',300],
  win:[620,.6,'triangle',400], lose:[220,.7,'sawtooth',-140], swap:[430,.08,'sine',120], ceiling:[190,.3,'square',-50],
  attackReady:[760,.25,'triangle',320], junk:[210,.2,'square',-50], target:[560,.12,'sine',180],
};
const key = (r,c) => r + ',' + c;
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const rnd = (a,b) => a + Math.random() * (b - a);
/* Short aim guides are a fixed stub off the barrel, not a share of the flight path. A
   share grew and shrank with how far the shot had to travel, which leaks exactly the
   distance information the shortened setting exists to withhold — and made the 25% guide
   nearly invisible on close targets. Lengths are in world units, so they read the same on
   every screen shape. */
const GUIDE_STUB = { 0.5: 9 * R, 0.25: 4 * R };
const trimPath = (pts, maxLen) => {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]];
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i-1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    if (len + d >= maxLen) {
      const t = d ? (maxLen - len) / d : 0;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return out;
    }
    out.push(b); len += d;
  }
  return out;
};
/* Shared aim integrator, mirrored verbatim in server/game.js so the client's prediction and
   the server's authority agree frame for frame. The barrel carries angular velocity instead
   of snapping between "turning at full speed" and "stopped": it ramps up over AIM_RAMP and
   brakes AIM_BRAKE times harder, which reads as weight without costing precision. With
   p.aimTarget set (point-to-aim) the same velocity glides onto the target and stops there;
   the glide speed is derived from the braking rate, so it lands rather than overshooting. */
const AIM_MAX = 1.22, AIM_RAMP = 0.12, AIM_BRAKE = 4;
/* 'halves' holds the lower-left or lower-right of the board to turn; 'point' aims the barrel
   at wherever the finger is. Both feed the same integrator below. */
const AIM_MODES = ['halves', 'point'];
const aimTick = (p, dt, aimSpeed) => {
  if (!(dt > 0)) return;
  const spd = Number(aimSpeed) > 0 ? Number(aimSpeed) : 2.4, accel = spd / AIM_RAMP;
  let want;
  if (p.aimTarget == null) want = (p.held && p.held.r ? spd : 0) - (p.held && p.held.l ? spd : 0);
  else {
    const gap = clamp(p.aimTarget, -AIM_MAX, AIM_MAX) - p.angle;
    // Never ask for more than this frame's remaining gap, or the last frame overshoots and
    // the barrel hunts back and forth across the target forever.
    const glide = Math.min(Math.sqrt(2 * accel * AIM_BRAKE * Math.abs(gap)), Math.abs(gap) / dt);
    want = clamp(gap < 0 ? -glide : glide, -spd, spd);
  }
  const vel = p.aimVel || 0;
  const rate = (Math.abs(want) < Math.abs(vel) || want * vel < 0) ? accel * AIM_BRAKE : accel;
  const next = vel + clamp(want - vel, -rate * dt, rate * dt);
  const raw = p.angle + next * dt, angle = clamp(raw, -AIM_MAX, AIM_MAX);
  p.angle = angle; p.aimVel = raw === angle ? next : 0; // no winding up against the stops
};
/* Quantised to 20 virtual units so a drifting viewport — browser chrome sliding away,
   a fold animation mid-frame — cannot churn the world height on every resize tick. */
const geom = vh => {
  const H = clamp(Math.round(vh / 20) * 20, VIEWH_MIN, VIEWH_MAX), LAUNCH_Y = H - LAUNCH_GAP;
  return { H, LAUNCH_Y, DANGER_Y: LAUNCH_Y - DANGER_GAP };
};

class CoopBubbles extends HTMLElement {
  connectedCallback() {
    if (this._init) return; this._init = true;
    this.setViewH(H0); // measure() refines this once .root has a box
    this.online = false; this.onlinePlayerId = null; this.onlineRoom = null; this.onlineSeq = 0;
    this.settings = { players:4, human:[true,false,false,false], botSkill:'normal',
      reload:1.35, missMax:12, rescueDur:4, assist:0.35, pressureShots:8, mateLines:true, sound:true, mode:'clear', field:'classic', guide:1, level:0,
      aimSpeed:2.4, padTint:0.025, fireScale:1, aimMode:'halves' };
    Object.assign(this.settings, this.loadLocalPrefs());
    this.buildDOM();
    this.resetGame();
    this.state = 'home';
    this.bindInput();
    this._raf = requestAnimationFrame(t => this.frame(t));
    try {
      const saved=JSON.parse(localStorage.getItem('bt_online_session')||'null');
      if(saved&&/^\d{3}$/.test(saved.code)&&saved.token){this.online=true;this._onlineCode=saved.code;this._onlineToken=saved.token;this.reconnectEl.style.display='grid';this.openOnlineSocket(true);}
    } catch(_) {}
  }
  /* Device preferences: they outlive a session instead of resetting with the game. Aim speed,
     touch tint and FIRE size are also room settings, so a host sets one set of controls for
     everyone and restoreLocalPrefs hands these back on the way out. The control scheme is
     not — which of two ways you like to aim is yours alone, and the server never sees it. */
  loadLocalPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('bt_prefs') || 'null') || {};
      const out = {};
      if (Number.isFinite(p.aimSpeed)) out.aimSpeed = clamp(p.aimSpeed, 0.6, 6);
      if (Number.isFinite(p.padTint)) out.padTint = clamp(p.padTint, 0, 0.3);
      if (Number.isFinite(p.fireScale)) out.fireScale = clamp(p.fireScale, 0.6, 2.2);
      if (AIM_MODES.includes(p.aimMode)) out.aimMode = p.aimMode;
      return out;
    } catch (_) { return {}; }
  }
  saveLocalPrefs() {
    const { aimSpeed, padTint, fireScale, aimMode } = this.settings;
    try { localStorage.setItem('bt_prefs', JSON.stringify({ aimSpeed, padTint, fireScale, aimMode })); } catch (_) {}
  }
  applyTouchStyle() {
    const root = this.rootEl; if (!root) return;
    const tint = this.settings.padTint;
    root.style.setProperty('--padTint', String(tint));
    root.style.setProperty('--padInk', tint ? '#2b6fd4' : 'rgba(43,74,112,.48)');
    root.style.setProperty('--fireScale', String(this.settings.fireScale));
    const mode = AIM_MODES.includes(this.settings.aimMode) ? this.settings.aimMode : 'halves';
    if (root.dataset.aimMode === mode) return;
    root.dataset.aimMode = mode;
    // Switching mid-hold would leave the control you just walked away from latched on.
    const p = this.aimPlayer();
    if (p) { p.held = { l:false, r:false }; p.aimTarget = null; }
    this._padHold = null;
    if (this.online) { this.setOnlineHeld('l', false); this.setOnlineHeld('r', false); this.setOnlineAim(null); }
  }
  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
    this._unbind && this._unbind();
    this._resizeObserver && this._resizeObserver.disconnect();
    this._availObserver && this._availObserver.disconnect();
    this._viewportUnbind && this._viewportUnbind();
    this._fullscreenUnbind && this._fullscreenUnbind();
    clearTimeout(this._reconnectTimer);
    if (this.ws) this.ws.close();
  }

  /* ---------- state / setup ---------- */
  /* Single writer for the adaptive world height. Returns whether it actually moved so
     callers can skip the relayout when the quantised value is unchanged. */
  setViewH(vh) {
    const g = geom(vh);
    if (g.H === this.H) return false;
    Object.assign(this, g);
    return true;
  }
  /* `carry` is set only by the Clear-mode level chain (see clearLevel), and mirrors
     OnlineGame.reset: score, stats and the clock survive, the miss meter does not. */
  resetGame(carry = null) {
    if (this.settings.mode === 'battle' && !this.online) { this.resetBattle(); return; }
    this.battle = null;
    if (!carry) { this._runStartLevel = this.settings.level; this._pendingLevel = null; }
    this.WW = this.settings.field === 'wide' ? W * 4 : W;
    this.cols = Math.floor((this.WW - 2 * X0) / (2 * R));
    this.grid = new Map(); this.parityFlip = 0; this.anchorRow = 0;
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
    this.sparks = []; this.ripples = []; this.dispScore = carry ? carry.score : 0;
    this.batch = []; this.resolveAt = 0; this.shotCount = 0; this.specialFlip = 0; this.specialWho = 0;
    this.score = carry ? carry.score : 0;
    this.missMeter = 0; this.pressure = 0; this.danger = null; this.shake = 0;
    if (!carry) this.now = 0;
    this.chain = { mult:1, last:-1, same:0, players:new Set(), t:0 };
    this.rowTimer = 0; this.lowestY = 0;
    this.spawnPlayers(carry);
    const pf0 = this.players[this.activeP] || this.players[0];
    this.camX = clamp(pf0.x - W / 2, 0, Math.max(0, this.WW - W));
    this.updateLowest();
    if (this.state !== 'tutorial') this.state = 'play';
    this.hideOverlays();
  }
  spawnPlayers(carry = null) {
    const n = this.settings.players, keep = this.players || [];
    this.players = [];
    for (let i = 0; i < n; i++) {
      const x = this.WW * (i + 0.5) / n;
      const old = keep[i];
      this.players.push({ i, meta: META[i], x, angle: old ? old.angle : rnd(-0.3,0.3),
        cur: this.genBubble(), next: this.genBubble(), reload: 0,
        bot: !this.settings.human[i], think: rnd(0.4,1.2), plan: null, held: {},
        stats: (carry && old) ? old.stats : { shots:0, pops:0, bubbles:0, assists:0, drops:0, rescues:0 } });
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
  ceilingY() { return this.gridTop + this.anchorRow * ROWH; } // top of the pack, descends with it
  neighbors(r,c) {
    const p = this.par(r), a = c - 1 + p, b = c + p;
    return [[r,c-1],[r,c+1],[r-1,a],[r-1,b],[r+1,a],[r+1,b]];
  }
  validCell(r,c) {
    if (c < 0 || c >= this.colsIn(r) || r < this.anchorRow || this.grid.has(key(r,c))) return false;
    if (r === this.anchorRow) return true;
    return this.neighbors(r,c).some(([nr,nc]) => this.grid.has(key(nr,nc)));
  }
  updateLowest() {
    let m = 0; this.grid.forEach(b => { const y = this.cellY(b.r); if (y > m) m = y; });
    this.lowestY = m;
  }
  snapCell(x,y) {
    const rr = Math.max(this.anchorRow, Math.round((y - this.gridTop - R) / ROWH));
    for (const span of [2, 5]) {
      let best = null, bd = 1e18;
      for (let r = Math.max(this.anchorRow, rr - span); r <= rr + span; r++) {
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
    if (this.online) { this.sendOnline('fire'); return; }
    const p = this.players[i];
    if (this.state !== 'play' || p.reload > 0) return;
    const a = clamp(p.angle, -1.22, 1.22);
    const sx = p.x, sy = this.LAUNCH_Y - 44, sp = 1150;
    this.flights.push({ p: i, x: sx, y: sy, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp,
      kind: p.cur.kind, special: p.cur.special, trail: [], bounceCd: 0 });
    p.cur = p.next; p.next = this.genBubble();
    p.reload = this.settings.reload; p.stats.shots++; this.pressure++; p.recoilT = this.now;
    for (let s = 0; s < 5; s++) this.sparks.push({ x: sx + Math.sin(a) * 34, y: sy - Math.cos(a) * 34,
      vx: Math.sin(a) * rnd(60, 180) + rnd(-40, 40), vy: -Math.cos(a) * rnd(60, 180) + rnd(-40, 40),
      g: 0, t: this.now, life: 0.35, color: 'rgba(255,255,255,0.85)', sz: rnd(4, 8), soft: true });
    this.sfx('launch');
  }
  /* Exchange the loaded bubble with the on-deck one. Mirrors OnlineGame.swap: gated on
     the same reload timer as fire(), so it is never a free re-roll mid-cooldown. */
  swapBubble(i) {
    if (this.online) { this.sendOnline('swap'); return; }
    const p = this.players[i === undefined ? this.activeP : i];
    if (!p || this.state !== 'play' || p.reload > 0 || !p.cur || !p.next) return;
    const held = p.cur; p.cur = p.next; p.next = held;
    p.cur.swapT = this.now; p.next.swapT = this.now;
    this.sfx('swap');
  }
  battleSwap() {
    const bt = this.battle;
    if (!bt || this.state !== 'play') return;
    if (bt.targeting && bt.targeting.by === bt.human.i) return;
    const b = bt.human; if (!b.alive) return;
    this.bindBoard(b); this.swapBubble(0); this.unbindBoard(b);
  }
  simulate(x0, angle) { // shared by aim guides + bots
    let x = x0, y = this.LAUNCH_Y - 44, bounces = 0;
    const st = 7, dx = Math.sin(angle) * st, dy = -Math.cos(angle) * st;
    let vx = dx; const pts = [{x,y}], bpts = [];
    for (let i = 0; i < 420; i++) {
      x += vx; y += dy;
      if (x < X0 + R) { x = 2 * (X0 + R) - x; vx = -vx; bounces++; bpts.push({x:X0+R, y}); }
      if (x > this.WW - X0 - R) { x = 2 * (this.WW - X0 - R) - x; vx = -vx; bounces++; bpts.push({x:this.WW-X0-R, y}); }
      if ((i & 1) === 0) pts.push({x,y});
      if (y <= this.ceilingY() + R) return { pts, bpts, bounces, cell: this.snapCell(x,y) };
      if (y < this.lowestY + 2.2 * R && this.hitGrid(x,y)) return { pts, bpts, bounces, cell: this.snapCell(x,y) };
    }
    return { pts, bpts, bounces, cell: null };
  }
  hitGrid(x,y) {
    const rr = Math.round((y - this.gridTop - R) / ROWH), lim = (2 * R * 0.88) ** 2;
    for (let r = Math.max(this.anchorRow, rr - 1); r <= rr + 1; r++) {
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
        if (f.y <= this.ceilingY() + R || (f.y < this.lowestY + 2.2*R && this.hitGrid(f.x, f.y))) landed = true;
      }
      if (landed) { this.flights.splice(fi, 1); this.land(f); }
      else if (f.y > this.H + 60) this.flights.splice(fi, 1);
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
      const pts = this.popPoints(popN) * mult;
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
      const pts = this.dropPoints(dropped.n, dropped.comps) * this.chain.mult;
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
    if (this.settings.mode === 'clear' && this.grid.size === 0 && this.state === 'play') this.clearLevel();
  }
  /* ---------- clear-mode level chain (mirrors OnlineGame.clearLevel) ---------- */
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
    if (from >= 0) this.recordProgress(from);
    if (next < 0) return this.endGame(true);
    this.state = 'levelup'; this.sfx('win');
    const sh = this.shadowRoot;
    sh.querySelector('.luTitle').textContent = '⭐ ' + (LEVELS[from]?.name || 'Level ' + (from + 1)) + ' cleared!';
    sh.querySelector('.luSub').textContent = 'Clear bonus +' + bonus.toLocaleString()
      + ' · Score ' + this.score.toLocaleString() + ' · Up next: ' + (LEVELS[next]?.name || 'Level ' + (next + 1));
    this._pendingLevel = next;
    this.levelUpEl.style.display = 'grid';
  }
  advanceLevel() {
    const next = this._pendingLevel;
    if (next === null || next === undefined) return;
    this._pendingLevel = null;
    this.settings.level = next;
    this.state = 'play';
    this.resetGame({ score: this.score });
    this._syncSettings?.();
  }
  /* Furthest authored level reached. Progress, not score — score lives on the server. */
  recordProgress(cleared) {
    try {
      const best = Math.max(Number(localStorage.getItem('bt_progress') || 0), cleared + 1);
      localStorage.setItem('bt_progress', String(Math.min(best, LEVELS.length - 1)));
    } catch (e) {}
  }
  supportCheck() {
    const safe = new Set(), st = [];
    this.grid.forEach((b,k) => { if (b.r === this.anchorRow) { safe.add(k); st.push(b); } });
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
  /* Superlinear so a patient 12-bubble cut beats four hurried 3s: 10/bubble plus a
     quadratic bonus on everything past the minimum match. Mirrors OnlineGame. */
  popPoints(n) { const over = Math.max(0, n - 3); return n * 10 + over * over * 10; }
  /* `comps` is how many separate clusters the cut severed at once. Each extra
     simultaneous cluster is worth half again, capped so a lucky shear stays sane. */
  dropPoints(n, comps) { const cascade = Math.min(3, 1 + 0.5 * Math.max(0, comps - 1)); return Math.round(n * 30 * cascade) + (n >= 5 ? 200 : 0); }
  registerClear(pi) {
    const ch = this.chain;
    // Solo runs have no second clearer to hand the chain to, so consecutive clears by
    // the only player must build the multiplier instead of resetting it.
    const solo = this.players.length <= 1;
    if (solo || ch.last !== pi) { ch.mult = Math.min(ch.mult + 1, 4); ch.same = 0; ch.pulseT = this.now; }
    else if (++ch.same >= 3) { ch.mult = 1; ch.players.clear(); ch.same = 0; }
    ch.last = pi; ch.players.add(pi); ch.t = 8;
    if (ch.mult >= 2) {
      if (ch.players.size >= 4) { this.callout('FOUR-PLAYER BURST!', '#ff6fb1'); this.score += 400; ch.players.clear(); }
      else if (ch.players.size === 3) this.callout('THREE-PLAYER CHAIN!', '#35d3c8');
      else this.callout((solo ? 'CHAIN ×' : 'TEAM CHAIN ×') + ch.mult, '#a78bfa');
      this.sfx('chain');
    }
  }
  centerOf(keys) {
    let sx = 0, sy = 0, n = 0;
    keys.forEach(k => { const [r,c] = k.split(',').map(Number); sx += this.cellX(r,c); sy += this.cellY(r); n++; });
    return n ? { x: sx/n, y: sy/n } : { x: W/2, y: 300 };
  }
  /* Puzzle Bobble ceiling descent: the whole pack slides down one row and the
     wall stagger alternates. Bumping r and parityFlip together leaves par(r) —
     and therefore cellX — invariant, so nothing drifts sideways. Dropping
     gridTop by ROWH in the same instant cancels the jump, and the existing
     gridTop -> gridTopTarget easing plays the slide out over ~0.6s. */
  descendRow() {
    const ng = new Map();
    this.grid.forEach(b => { b.r += 1; ng.set(key(b.r,b.c), b); });
    this.grid = ng; this.parityFlip ^= 1;
    this.anchorRow += 1; this.gridTop -= ROWH;
    this.updateLowest(); this.refreshQueues();
  }
  shotsPerDrop() { // shots between drops, tightening as colours leave the field
    const base = this.settings.pressureShots;
    return base ? Math.max(3, base - (KINDS.length - this.availKinds().length)) : 0;
  }
  pressureDescend() {
    this.pressure = 0; this.descendRow();
    this.callout('ROW PUSH!', '#ff5b6b'); this.sfx('ceiling'); this.shake = 8;
  }
  ceilingDescend() {
    this.missMeter = 0; this.descendRow();
    this.callout('CEILING DROPS!', '#ff5b6b'); this.sfx('ceiling'); this.shake = 8;
  }
  addRow() { // endless survival: push a new row in at the top
    const ng = new Map();
    this.grid.forEach(b => { b.r += 1; ng.set(key(b.r,b.c), b); });
    this.grid = ng; this.parityFlip ^= 1;
    const a = this.anchorRow, n = this.colsIn(a), av = KINDS;
    for (let c = 0; c < n; c++) if (Math.random() < 0.85)
      this.grid.set(key(a,c), { r:a, c, kind: av[(Math.random()*av.length)|0], special: null, placedBy: -1 });
    this.updateLowest(); this.refreshQueues(); this.sfx('ceiling');
  }
  anyDangerCells() {
    let hit = false;
    this.grid.forEach(b => { if (this.cellY(b.r) + R > this.DANGER_Y) hit = true; });
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
          if (low + R > this.DANGER_Y - ROWH * 1.5) s += 900;
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
    if (this.battle && this.settings.mode === 'battle') {
      if (!this.online && this.state === 'play') this.battleUpdate(dt);
      else if (this.online && ['play','paused','spectating','won','lost'].includes(this.state)) this.updateOnlineBattleVisuals(dt);
      this.battleRender();
      return;
    }
    if (this.state === 'play' && !this.online) this.update(dt);
    else if (this.online && ['play','paused','won','lost'].includes(this.state)) this.updateOnlineVisuals(dt);
    this.render();
  }
  /* Own-launcher prediction. The server runs the same aimTick over the same input stream, so
     while the finger is down the two differ only by the round trip: the snapshot angle is
     this barrel a moment ago. Correcting toward it mid-hold would drag the barrel backwards
     against the player — which, applied twenty times a second, is what made online aiming
     feel stepped. So the hold is pure prediction, and the moment input stops the server
     catches up to exactly where the prediction already is. Only an idle launcher is
     reconciled: a gentle drift for ordinary drift, an outright take for a gap no drift can
     hide (a dropped input, a resume, a rejoin). */
  predictOwnAim(p, dt) {
    this.flushOnlineAim();
    p.held = this._onlineHeld || { l:false, r:false };
    p.aimTarget = this._onlineAimWant ?? null; // predict from the finger, not the last packet
    aimTick(p, dt, this.settings.aimSpeed);
    if (p.serverAngle === undefined || p.held.l || p.held.r || p.aimTarget != null) return;
    const gap = p.serverAngle - p.angle;
    if (Math.abs(gap) > 0.35) { p.angle = p.serverAngle; p.aimVel = 0; }
    else p.angle = clamp(p.angle + clamp(gap, -3 * dt, 3 * dt), -AIM_MAX, AIM_MAX);
  }
  // Everyone else's barrel: interpolate toward the last snapshot rather than teleporting to it.
  followServerAim(p, dt) {
    if (p.serverAngle === undefined) return;
    const gap = p.serverAngle - p.angle;
    p.angle = Math.abs(gap) > 0.6 ? p.serverAngle : p.angle + gap * Math.min(1, 14 * dt);
    p.aimVel = 0;
  }
  updateOnlineVisuals(dt) {
    if (this.state !== 'paused') {
      this.now += dt;
      const own=this.players[this.activeP];
      if(own)this.predictOwnAim(own,dt);
      for(const p of this.players){p.reload=Math.max(0,p.reload-dt);if(p!==own)this.followServerAim(p,dt);}
      for(const f of this.flights){f.x+=f.vx*dt;f.y+=f.vy*dt;if(f.x<X0+R||f.x>this.WW-X0-R)f.vx=-f.vx;}
      if(this.danger)this.danger.t=Math.max(0,this.danger.t-dt);
      const floor=92+this.LAUNCH_Y-60-R+6;
      for(let i=this.falling.length-1;i>=0;i--){const f=this.falling[i];f.vy+=1900*dt;f.x+=f.vx*dt;f.y+=f.vy*dt;f.a+=f.spin*dt;if(f.y>floor){f.y=floor;f.fade=(f.fade??1)-2.5*dt;}if((f.fade??1)<=0)this.falling.splice(i,1);}
      const p=this.players[this.activeP];if(p){const target=clamp(p.x+Math.sin(p.angle)*420-W/2,0,Math.max(0,this.WW-W));this.camX+=(target-this.camX)*Math.min(1,6*dt);}
    }
    this.fxTick();
  }
  updateOnlineBattleVisuals(dt) {
    const bt=this.battle;if(!bt)return;
    if(this.state!=='paused'){
      this.now+=dt;if(bt.targeting)bt.targeting.t=Math.max(0,bt.targeting.t-dt);
      const b=bt.human;if(b){this.bindBoard(b);const p=b.player;
        if(this.state==='play'&&!bt.targeting)this.predictOwnAim(p,dt);else this.followServerAim(p,dt);
        p.reload=Math.max(0,(p.reload||0)-dt);for(const f of this.flights){f.x+=f.vx*dt;f.y+=f.vy*dt;if(f.x<X0+R||f.x>W-X0-R)f.vx=-f.vx;}
        if(this.danger)this.danger.t=Math.max(0,this.danger.t-dt);this.fxTick();this.unbindBoard(b);}
    }
    const want=!!bt.targeting||bt.spectate;bt.zoom=clamp(bt.zoom+(want?6:-6)*dt,0,1);
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
        if (p.held.l || p.held.r || p.aimTarget != null) this.activeP = p.i;
        aimTick(p, rdt, this.settings.aimSpeed);
      }
    }
    // camera follows the active player's aim (wide field)
    const pf = this.players[this.activeP] || this.players[0];
    const camT = clamp(pf.x + Math.sin(pf.angle) * 420 - W / 2, 0, Math.max(0, this.WW - W));
    this.camX += (camT - this.camX) * Math.min(1, 6 * rdt);
    this.stepFlights(dt);
    if (this.resolveAt && this.now >= this.resolveAt) this.resolveBatch();
    const perDrop = this.shotsPerDrop();
    if (perDrop && this.pressure >= perDrop && !this.resolveAt) this.pressureDescend();
    // falling bubbles (bounce once on the floor edge, splash, fade)
    const FLOOR = 92 + this.LAUNCH_Y - 60 - R + 6;
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
      if ((f.fade !== undefined && f.fade <= 0) || f.y > this.H + 60) this.falling.splice(i, 1);
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
    if (this._sfxMute) return;
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
  canvasPoint(e) { const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / Math.max(1, r.width), y: (e.clientY - r.top) * this.H / Math.max(1, r.height) }; }
  /* Which pad control a touch belongs to. Exact hits resolve first, keeping the swap button's
     long-standing precedence where it overlaps FIRE, so a deliberate swap tap is never stolen.
     Only then are near misses rescued, and there FIRE outranks everything: it is the button
     being reached for on nearly every touch, and the aim halves underneath it are transparent
     full-height overlays that would otherwise turn the launcher instead of shooting. */
  padHit(x, y) {
    const slop = this.padSlop();
    if (this.padBoxHit('.padS', x, y, 0)) return 'swap';
    if (this.padBoxHit('.padF', x, y, 0)) return 'fire';
    if (slop && this.padBoxHit('.padF', x, y, slop)) return 'fire';
    if (slop && this.padBoxHit('.padS', x, y, slop)) return 'swap';
    if (this.padBoxHit('.padA', x, y, 0)) return 'aim';
    if (this.padBoxHit('.padL', x, y, 0)) return 'l';
    if (this.padBoxHit('.padR', x, y, 0)) return 'r';
    return null;
  }
  padBoxHit(sel, x, y, slop) {
    const el = this.shadowRoot.querySelector(sel); if (!el) return false;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
    return x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop;
  }
  /* Forgiveness scales with the board (--u) and with the FIRE size setting, so a bigger
     button also gets a proportionally bigger halo. Only coarse pointers get it: on desktop
     the four pad buttons sit side by side and a halo would swallow its neighbours. */
  padSlop() {
    if (!this.gameColEl || !matchMedia('(pointer: coarse)').matches) return 0;
    const u = parseFloat(getComputedStyle(this.gameColEl).getPropertyValue('--u')) || 1;
    return 22 * u * (this.settings.fireScale || 1);
  }
  firstHumanPlayer() { return (this.players || []).find(q => !q.bot) || null; }
  // The launcher this device's finger drives, across local, local battle and online play.
  aimPlayer() {
    if (this.battle && this.settings.mode === 'battle') return this.battle.human?.player || null;
    if (this.online) return (this.players || [])[this.activeP] || null;
    return this.firstHumanPlayer();
  }
  padFire() {
    if (this.battle && this.settings.mode === 'battle' && !this.online) { this.battleFire(); return; }
    if (this.online) { this.fire(); return; }
    const p = this.firstHumanPlayer(); if (p) { this.activeP = p.i; this.fire(p.i); }
  }
  padSwap() {
    if (this.battle && this.settings.mode === 'battle' && !this.online) { this.battleSwap(); return; }
    if (this.online) { this.swapBubble(); return; }
    const p = this.firstHumanPlayer(); if (p) { this.activeP = p.i; this.swapBubble(p.i); }
  }
  // Hold-to-turn. Returns the launcher engaged so the release hits the same one.
  padAimHold(dir, value, player) {
    if (this.battle && this.settings.mode === 'battle' && !this.online) {
      const p = player || this.battle.human?.player; if (!p) return null;
      p.held[dir] = value; if (value) p.aimTarget = null; return p;
    }
    if (this.online) { this.setOnlineHeld(dir, value); return null; }
    const p = player || this.firstHumanPlayer(); if (!p) return null;
    p.held[dir] = value; if (value) { p.aimTarget = null; this.activeP = p.i; }
    return p;
  }
  /* Point-to-aim. The finger names an angle from the launcher to the spot it is touching and
     aimTick glides the barrel onto it, so the cannon swings there rather than teleporting.
     A null event is finger-up, which hands the launcher back to the held-direction stream. */
  padAimPoint(e) {
    const p = this.aimPlayer(); if (!p) return;
    if (!e) { p.aimTarget = null; if (this.online) this.setOnlineAim(null); return; }
    const pt = this.canvasPoint(e);
    const angle = clamp(Math.atan2(pt.x + (this.camX || 0) - p.x, (this.LAUNCH_Y - 44) - pt.y), -AIM_MAX, AIM_MAX);
    p.aimTarget = angle; p.held = { l:false, r:false };
    if (this.online) this.setOnlineAim(angle);
    else if (!this.battle) this.activeP = p.i;
  }
  /* Picking an attack target is the one thing that reads the board directly. In point-to-aim
     the surface covers the board, so the pad router hands these two through rather than
     letting an aim drag swallow the choice. */
  battleHoverAt(e) { if (this.battleTargetActive()) this.battle.targeting.hover = this.battleSlotAt(this.canvasPoint(e)); }
  battlePickAt(e) {
    if (!this.battleTargetActive()) return;
    const s = this.battleSlotAt(this.canvasPoint(e)), tg = this.battle.targeting;
    if (s >= 0) { const t = this.battle.boards[s];
      if (t.alive && s !== tg.by) this.chooseBattleTarget(t); }
  }
  bindInput() {
    this.canvas.addEventListener('pointerdown', () => this.ensureAudio());
    this.canvas.addEventListener('pointermove', e => this.battleHoverAt(e));
    this.canvas.addEventListener('pointerdown', e => this.battlePickAt(e));
    const keymap = { // player input streams by key
      a:[1,'l'], d:[1,'r'], arrowleft:[2,'l'], arrowright:[2,'r'], j:[3,'l'], l:[3,'r'],
    };
    const firemap = { w:1, ' ':1, arrowup:2, enter:2, k:3 };
    const swapmap = { s:1, arrowdown:2, i:3 };
    const swapKeys = ['s','arrowdown','i']; // union, for the single-launcher modes
    const kd = e => {
      if (/input|select|textarea/i.test(e.target.tagName)) return;
      this.ensureAudio();
      const k = e.key.toLowerCase();
      if (k === 'p') { this.togglePause(); return; }
      if (this.battle && this.settings.mode === 'battle') {
        const bt = this.battle, tg = bt.targeting;
        if (tg && tg.by === bt.human.i) {
          const num = parseInt(k, 10);
          if (num >= 1 && num <= bt.boards.length) { const t = bt.boards[num - 1];
            if (t.alive && t.i !== tg.by) this.chooseBattleTarget(t); e.preventDefault(); }
          return;
        }
        if (this.online) {
          if (['a','arrowleft','j'].includes(k)) { this.setOnlineHeld('l', true); e.preventDefault(); }
          if (['d','arrowright','l'].includes(k)) { this.setOnlineHeld('r', true); e.preventDefault(); }
          if (['w',' ','arrowup','enter','k'].includes(k)) { this.fire(); e.preventDefault(); }
          if (swapKeys.includes(k)) { this.swapBubble(); e.preventDefault(); }
          return;
        }
        const hp = bt.human.player;
        if (['a','arrowleft','j'].includes(k)) { hp.held.l = true; hp.aimTarget = null; e.preventDefault(); }
        if (['d','arrowright','l'].includes(k)) { hp.held.r = true; hp.aimTarget = null; e.preventDefault(); }
        if (['w',' ','arrowup','enter','k'].includes(k)) { this.battleFire(); e.preventDefault(); }
        if (swapKeys.includes(k)) { this.battleSwap(); e.preventDefault(); }
        return;
      }
      if (this.online) {
        if (['a','arrowleft','j'].includes(k)) { this.setOnlineHeld('l', true); e.preventDefault(); }
        if (['d','arrowright','l'].includes(k)) { this.setOnlineHeld('r', true); e.preventDefault(); }
        if (['w',' ','arrowup','enter','k'].includes(k)) { this.fire(); e.preventDefault(); }
        if (swapKeys.includes(k)) { this.swapBubble(); e.preventDefault(); }
        return;
      }
      const am = keymap[k];
      if (am) { const p = this.players[am[0]]; if (p && !p.bot) { p.held[am[1]] = true; p.aimTarget = null; e.preventDefault(); } }
      if (firemap[k] !== undefined) { const p = this.players[firemap[k]]; if (p && !p.bot) { this.fire(firemap[k]); e.preventDefault(); } }
      if (swapmap[k] !== undefined) { const p = this.players[swapmap[k]]; if (p && !p.bot) { this.swapBubble(swapmap[k]); e.preventDefault(); } }
    };
    const ku = e => { const k=e.key.toLowerCase();
      if(this.battle&&this.settings.mode==='battle'&&!this.online){const hp=this.battle.human.player;if(['a','arrowleft','j'].includes(k))hp.held.l=false;if(['d','arrowright','l'].includes(k))hp.held.r=false;return;}
      if(this.online){if(['a','arrowleft','j'].includes(k))this.setOnlineHeld('l',false);if(['d','arrowright','l'].includes(k))this.setOnlineHeld('r',false);return;} const am = keymap[k];
      if (am) { const p = this.players[am[0]]; if (p) p.held[am[1]] = false; } };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this._unbind = () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }
  togglePause() {
    if (this.online) {
      if (!this.onlineRoom || this.onlineRoom.hostId !== this.onlinePlayerId) return;
      this.sendOnline(this.state === 'paused' ? 'resume' : 'pause'); return;
    }
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
    const bg = ctx.createLinearGradient(0, 0, 0, this.H);
    bg.addColorStop(0, '#eaf4ff'); bg.addColorStop(1, '#d8ecff');
    ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, this.H + 40);
    ctx.save(); ctx.translate(-this.camX, 0);
    const vwL = this.camX - 2 * R, vwR = this.camX + W + 2 * R;
    // field panel
    ctx.fillStyle = '#f9fcff';
    this.rrect(ctx, X0 - 6, 92, this.WW - 2 * (X0 - 6), this.LAUNCH_Y - 60, 26); ctx.fill();
    ctx.strokeStyle = '#c4ddf5'; ctx.lineWidth = 3; ctx.stroke();
    // honeycomb ghost grid
    ctx.save(); ctx.beginPath();
    this.rrect(ctx, X0 - 6, 92, this.WW - 2 * (X0 - 6), this.LAUNCH_Y - 60, 26); ctx.clip();
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
    ctx.fillStyle = sg; ctx.fillRect(X0 - 6, 92, 32, this.LAUNCH_Y - 60);
    sg = ctx.createLinearGradient(this.WW - X0 + 6, 0, this.WW - X0 - 26, 0);
    sg.addColorStop(0, 'rgba(60,100,150,0.14)'); sg.addColorStop(1, 'rgba(60,100,150,0)');
    ctx.fillStyle = sg; ctx.fillRect(this.WW - X0 - 26, 92, 32, this.LAUNCH_Y - 60);
    ctx.strokeStyle = 'rgba(90,140,190,0.10)'; ctx.lineWidth = 1.4;
    const maxR = Math.ceil((this.DANGER_Y - this.gridTop) / ROWH);
    for (let r = this.anchorRow; r <= maxR; r++) {
      const n = this.colsIn(r);
      for (let c = 0; c < n; c++) {
        const gx = this.cellX(r,c); if (gx < vwL || gx > vwR) continue;
        ctx.beginPath(); ctx.arc(gx, this.cellY(r), R - 5, 0, 7); ctx.stroke();
      }
    }
    ctx.restore();
    // ceiling (rides down with the pack as rows are pushed in)
    const cy = this.ceilingY();
    const cg = ctx.createLinearGradient(0, 60, 0, cy);
    cg.addColorStop(0, '#9fc4e8'); cg.addColorStop(1, '#b9d7f2');
    ctx.fillStyle = cg; ctx.fillRect(X0 - 6, 60, this.WW - 2*(X0-6), cy - 60);
    ctx.strokeStyle = '#8fb6dd'; ctx.lineWidth = 2;
    const hx0 = Math.floor(Math.max(X0, this.camX) / 26) * 26;
    for (let x = hx0; x < Math.min(this.WW - X0, this.camX + W); x += 26) {
      ctx.beginPath(); ctx.moveTo(x, cy - 3); ctx.lineTo(x + 12, cy - 16); ctx.stroke();
    }
    ctx.fillStyle = '#7ba7d1'; ctx.fillRect(X0 - 6, cy - 4, this.WW - 2*(X0-6), 4);
    const tg = ctx.createLinearGradient(0, cy, 0, cy + 22);
    tg.addColorStop(0, 'rgba(60,100,150,0.16)'); tg.addColorStop(1, 'rgba(60,100,150,0)');
    ctx.fillStyle = tg; ctx.fillRect(X0 - 6, cy, this.WW - 2*(X0-6), 22);
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
      const dangerB = this.danger && this.cellY(b.r) + R > this.DANGER_Y;
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
    const vg = ctx.createRadialGradient(W/2, this.H/2, this.H*0.35, W/2, this.H/2, this.H*0.75);
    vg.addColorStop(0, 'rgba(40,70,120,0)'); vg.addColorStop(1, 'rgba(40,70,120,0.10)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, this.H);
    if (this.danger && this.state === 'play') {
      ctx.fillStyle = 'rgba(140,160,200,0.10)'; ctx.fillRect(0, 0, W, this.H);
      const dp = 0.22 + Math.sin(this.now * 8) * 0.12;
      const eg = ctx.createRadialGradient(W/2, this.H/2, this.H*0.3, W/2, this.H/2, this.H*0.72);
      eg.addColorStop(0, 'rgba(255,91,107,0)'); eg.addColorStop(1, 'rgba(255,91,107,' + dp.toFixed(3) + ')');
      ctx.fillStyle = eg; ctx.fillRect(0, 0, W, this.H);
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
      ctx.fillStyle = '#3a5a80'; ctx.fillText('\u266a ' + s.name, X0 + 6, this.LAUNCH_Y - 78 - i * 20);
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
    const pts = frac >= 1 ? sim.pts : trimPath(sim.pts, GUIDE_STUB[frac] || GUIDE_STUB[0.5]);
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = meta.accent; ctx.fillStyle = meta.accent;
    if (meta.trail === 'solid') {
      ctx.lineWidth = 3; ctx.setLineDash([]);
      ctx.beginPath(); pts.forEach((q,i) => i ? ctx.lineTo(q.x,q.y) : ctx.moveTo(q.x,q.y)); ctx.stroke();
    } else if (meta.trail === 'dots') {
      ctx.setLineDash([2, 14]); ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach((q,i) => i ? ctx.lineTo(q.x,q.y) : ctx.moveTo(q.x,q.y)); ctx.stroke(); ctx.setLineDash([]);
    } else if (meta.trail === 'rings') {
      // Marker styles are spaced by point index, so a stub needs a tighter step to read as
      // a direction rather than as one stray mark.
      const step = frac >= 1 ? 5 : 3;
      for (let i = step - 1; i < pts.length; i += step) { ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 5, 0, 7); ctx.stroke(); }
    } else {
      const step = frac >= 1 ? 4 : 3;
      for (let i = step - 1; i < pts.length; i += step) { const q = pts[i]; ctx.lineWidth = 2;
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
    const x = p.x, y = this.LAUNCH_Y, meta = p.meta;
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
    const npulse = p.next.swapT && this.now - p.next.swapT < 0.5 ? 1 + Math.sin((this.now - p.next.swapT) * 20) * 0.12 : 1;
    this.drawBubble(ctx, x + 40, y + 6, 13 * npulse, p.next.kind, p.next.special, false, false);
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
    ctx.beginPath(); ctx.moveTo(X0, this.DANGER_Y); ctx.lineTo(this.WW - X0, this.DANGER_Y); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '600 14px Fredoka, sans-serif'; ctx.fillStyle = 'rgba(255,91,107,0.7)'; ctx.textAlign = 'right';
    ctx.fillText('danger line', this.camX + W - X0 - 8, this.DANGER_Y - 8);
    if (this.danger) {
      const pulse = 0.10 + Math.sin(this.now * 8) * 0.07;
      ctx.fillStyle = 'rgba(255,91,107,' + pulse + ')';
      ctx.fillRect(X0 - 6, this.DANGER_Y - ROWH * 1.6, this.WW - 2*(X0-6), ROWH * 1.6);
      // countdown
      const t = Math.max(0, this.danger.t), cx0 = this.camX + W / 2;
      ctx.textAlign = 'center';
      ctx.font = '700 84px Fredoka, sans-serif';
      ctx.lineWidth = 10; ctx.strokeStyle = '#fff';
      ctx.strokeText(t.toFixed(1), cx0, this.DANGER_Y - 60);
      ctx.fillStyle = '#ff5b6b'; ctx.fillText(t.toFixed(1), cx0, this.DANGER_Y - 60);
      ctx.font = '600 22px Fredoka, sans-serif';
      ctx.lineWidth = 6; ctx.strokeText('CLEAR THE GLOWING BUBBLES!', cx0, this.DANGER_Y - 20);
      ctx.fillText('CLEAR THE GLOWING BUBBLES!', cx0, this.DANGER_Y - 20);
    }
  }
  drawHUD(ctx) {
    if (this.battle && this.settings.mode === 'battle' && !this.online) return this.drawBattleStrip(ctx);
    ctx.textAlign = 'left';
    // Keep both boxes clear of the corner buttons, which grow relative to a narrow board.
    const hx = this.chromeInset || X0;
    const mw = 170, mx = W - hx - 12 - mw, my = 34;
    ctx.save(); ctx.shadowColor = 'rgba(40,80,140,0.18)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    this.rrect(ctx, hx, 10, 190, 64, 16); ctx.fill();
    this.rrect(ctx, mx - 12, 10, mw + 24, 64, 16); ctx.fill();
    ctx.restore();
    ctx.font = '700 32px Fredoka, sans-serif'; ctx.fillStyle = '#17335c';
    ctx.fillText(Math.round(this.dispScore || 0).toLocaleString(), hx + 14, 46);
    ctx.font = '600 13px Fredoka, sans-serif'; ctx.fillStyle = '#7593b5';
    ctx.fillText('TEAM SCORE', hx + 14, 65);
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
      /* The strapline is decoration between two boxes whose width is fixed but whose
         inset grows on a narrow board. Drop it rather than run it underneath them. */
      ctx.fillStyle = '#9db8d4'; ctx.font = '600 17px Fredoka, sans-serif';
      const tag = this.settings.mode === 'clear' ? 'clear the field together!' : 'endless survival';
      if (ctx.measureText(tag).width + 16 <= (mx - 12) - (hx + 190)) ctx.fillText(tag, W/2, 42);
    }
    // miss meter (secondary)
    ctx.textAlign = 'right'; ctx.font = '600 13px Fredoka, sans-serif'; ctx.fillStyle = '#7593b5';
    ctx.fillText('MISS METER \u2192 ceiling drops', W - hx - 14, my - 6);
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
    // shots until the next row push
    const left = this.dropCountdown();
    if (left !== null) {
      ctx.font = '700 13px Fredoka, sans-serif';
      ctx.fillStyle = left <= 1 ? '#ff5b6b' : left <= 3 ? '#ffb054' : '#7593b5';
      ctx.fillText('ROW PUSH IN ' + left + (left === 1 ? ' SHOT' : ' SHOTS'), W - hx - 14, my + 30);
    }
  }
  // shots remaining before the field pushes down; null when the mechanic is off.
  // Online snapshots sync both the grid and the settings, so the threshold
  // recomputes identically here without trusting a separate wire field.
  dropCountdown() {
    const perDrop = this.shotsPerDrop();
    return perDrop ? Math.max(0, perDrop - (this.pressure || 0)) : null;
  }

  /* ---------- battle royale mode ---------- */
  resetBattle() {
    this.WW = W; this.cols = COLS; this.camX = 0;
    const n = clamp(this.settings.players, 2, 8);
    this.battle = { boards: [], phase: 'play', targeting: null, zoom: 0, order: [], winner: -1, spectate: false, view: 0 };
    for (let i = 0; i < n; i++) this.battle.boards.push(this.makeBattleBoard(i, i !== 0));
    this.battle.human = this.battle.boards[0];
    this.flights = []; this.falling = []; this.pops = []; this.sparks = []; this.ripples = []; this.callouts = []; this.popups = []; this.sfxLog = [];
    this.batch = []; this.resolveAt = 0; this.danger = null; this.shake = 0; this.now = 0; this.dispScore = 0;
    this.chain = { mult: 1, last: -1, same: 0, players: new Set(), t: 0 };
    if (this.state !== 'tutorial') this.state = 'play';
    this.hideOverlays();
  }
  makeBattleBoard(i, bot) {
    const b = { i, meta: META[i], alive: true, grid: new Map(), parityFlip: 0, anchorRow: 0,
      gridTop: GRIDTOP0, gridTopTarget: GRIDTOP0, lowestY: 0,
      flights: [], falling: [], pops: [], sparks: [], ripples: [], callouts: [], popups: [],
      batch: [], resolveAt: 0, shotCount: 0, specialFlip: 0,
      score: 0, dispScore: 0, missMeter: 0, pressure: 0, danger: null,
      attackFlash: -9, chargeFlash: -9, attackPend: null, _dead: false };
    const rows = this.levelRows();
    rows.forEach((row, r) => { for (let c = 0; c < row.length; c++)
      if (row[c] !== '.') b.grid.set(key(r, c), { r, c, kind: row[c], special: null, placedBy: -1 }); });
    b.player = { i: 0, meta: META[i], x: W / 2, angle: rnd(-0.3, 0.3), cur: null, next: null,
      reload: 0, bot, think: rnd(0.6, 1.8), plan: null, held: {},
      stats: { shots: 0, pops: 0, bubbles: 0, assists: 0, drops: 0, rescues: 0, attacks: 0 } };
    b.playersArr = [b.player];
    this.bindBoard(b);
    const safe = new Set(), st = [];
    this.grid.forEach((g, kk) => { if (g.r === 0) { safe.add(kk); st.push(g); } });
    while (st.length) { const g = st.pop();
      for (const [nr, nc] of this.neighbors(g.r, g.c)) { const kk = key(nr, nc), nb = this.grid.get(kk);
        if (nb && !safe.has(kk)) { safe.add(kk); st.push(nb); } } }
    [...this.grid.keys()].forEach(kk => { if (!safe.has(kk)) this.grid.delete(kk); });
    b.player.cur = this.genBubble(); b.player.next = this.genBubble();
    this.updateLowest();
    this.unbindBoard(b);
    return b;
  }
  bindBoard(b) {
    this._boundBoard = b;
    this.grid = b.grid; this.parityFlip = b.parityFlip; this.anchorRow = b.anchorRow;
    this.gridTop = b.gridTop; this.gridTopTarget = b.gridTopTarget; this.lowestY = b.lowestY;
    this.flights = b.flights; this.falling = b.falling; this.pops = b.pops; this.sparks = b.sparks;
    this.ripples = b.ripples; this.callouts = b.callouts; this.popups = b.popups;
    this.batch = b.batch; this.resolveAt = b.resolveAt; this.shotCount = b.shotCount; this.specialFlip = b.specialFlip;
    this.players = b.playersArr; this.activeP = 0;
    this.score = b.score; this.dispScore = b.dispScore; this.missMeter = b.missMeter; this.danger = b.danger;
    this.pressure = b.pressure;
    this.camX = 0; this.WW = W; this.cols = COLS;
  }
  unbindBoard(b) {
    b.grid = this.grid; b.parityFlip = this.parityFlip; b.anchorRow = this.anchorRow;
    b.gridTop = this.gridTop; b.gridTopTarget = this.gridTopTarget; b.lowestY = this.lowestY;
    b.flights = this.flights; b.falling = this.falling; b.pops = this.pops; b.sparks = this.sparks;
    b.ripples = this.ripples; b.callouts = this.callouts; b.popups = this.popups;
    b.batch = this.batch; b.resolveAt = this.resolveAt; b.shotCount = this.shotCount; b.specialFlip = this.specialFlip;
    b.score = this.score; b.dispScore = this.dispScore; b.missMeter = this.missMeter; b.danger = this.danger;
    b.pressure = this.pressure; b.perDrop = this.shotsPerDrop();
    this._boundBoard = null;
  }
  battleFire() {
    const bt = this.battle;
    if (!bt || this.state !== 'play') return;
    if (bt.targeting && bt.targeting.by === bt.human.i) return;
    const b = bt.human; if (!b.alive) return;
    this.bindBoard(b); this.fire(0); this.unbindBoard(b);
  }
  battleTargetActive() {
    const bt = this.battle;
    return !!(bt && this.settings.mode === 'battle' && this.state === 'play' && bt.targeting && bt.targeting.by === bt.human.i && bt.zoom > 0.5);
  }
  chooseBattleTarget(board) {
    const bt=this.battle,tg=bt&&bt.targeting;if(!tg||!board?.alive||board.i===tg.by)return;
    if(this.online)this.sendOnline('target',{targetId:board.id});else this.deliverAttack(tg.by,board.i,tg.amount);
  }
  battleUpdate(rdt) {
    const bt = this.battle;
    this.now += rdt;
    const tg = bt.targeting;
    if (tg) {
      tg.t -= rdt;
      if (tg.t <= 0) {
        const opts = bt.boards.filter(q => q.alive && q.i !== tg.by);
        if (opts.length) this.deliverAttack(tg.by, opts[(Math.random() * opts.length) | 0].i, tg.amount);
        else bt.targeting = null;
      }
    }
    const wantZoom = (bt.targeting && bt.targeting.by === bt.human.i) || bt.spectate;
    bt.zoom = clamp(bt.zoom + (wantZoom ? 6 : -6) * rdt, 0, 1);
    for (const b of bt.boards) {
      if (!b.alive) { this.stepLoose(b, rdt); continue; }
      this._sfxMute = b.i !== bt.view;
      this.bindBoard(b);
      this.boardTick(b, rdt, bt.targeting);
      this.unbindBoard(b);
      this._sfxMute = false;
    }
    for (const b of bt.boards) if (b._dead) { b._dead = false; this.eliminate(b); }
    for (const b of bt.boards) if (b.attackPend && b.alive) {
      b.attackPend.t -= rdt;
      if (b.attackPend.t <= 0) {
        const amt = b.attackPend.amount; b.attackPend = null;
        const opts = bt.boards.filter(q => q.alive && q.i !== b.i);
        if (opts.length) {
          opts.sort((u, v) => v.score - u.score);
          const pick = Math.random() < 0.6 ? opts[0] : opts[(Math.random() * opts.length) | 0];
          this.deliverAttack(b.i, pick.i, amt);
        }
      }
    }
    this.shake = Math.max(0, this.shake - 40 * rdt);
    if (bt.phase === 'play') {
      const alive = bt.boards.filter(q => q.alive);
      if (alive.length <= 1) this.endBattle(alive[0] || null);
    }
  }
  boardTick(b, rdt, tg) {
    const p = b.player;
    p.reload = Math.max(0, p.reload - rdt);
    this.gridTop += clamp(this.gridTopTarget - this.gridTop, -80 * rdt, 80 * rdt);
    const locked = tg && tg.by === b.i && !p.bot;
    if (p.bot) this.botUpdate(p, rdt);
    else if (!locked) aimTick(p, rdt, this.settings.aimSpeed);
    else { p.aimVel = 0; p.aimTarget = null; } // choosing a target parks the barrel where it is
    this.stepFlights(rdt);
    if (this.resolveAt && this.now >= this.resolveAt) this.battleResolve(b);
    const perDrop = this.shotsPerDrop();
    if (perDrop && this.pressure >= perDrop && !this.resolveAt) {
      const pre = this.shake; this.pressureDescend();
      if (b.i !== this.battle.view) this.shake = pre; // only the watched board shakes the screen
    }
    const FLOOR = 92 + this.LAUNCH_Y - 60 - R + 6;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.vy += 1900 * rdt; f.x += f.vx * rdt; f.y += f.vy * rdt; f.a += f.spin * rdt;
      if (f.y > FLOOR && f.vy > 0) {
        f.b = (f.b || 0) + 1; f.y = FLOOR; f.vy *= -0.45; f.vx *= 0.75; f.spin *= 0.6;
        for (let s = 0; s < 4; s++) this.sparks.push({ x: f.x + rnd(-8, 8), y: FLOOR + R * 0.7,
          vx: rnd(-140, 140), vy: rnd(-260, -60), g: 1500, t: this.now, life: 0.5,
          color: PAL[f.kind] || '#fff', sz: rnd(2.5, 5) });
      }
      if (f.b >= 2) f.fade = (f.fade !== undefined ? f.fade : 1) - 3 * rdt;
      if ((f.fade !== undefined && f.fade <= 0) || f.y > this.H + 60) this.falling.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.vy += (s.g || 0) * rdt; s.x += s.vx * rdt; s.y += s.vy * rdt;
      if (this.now - s.t > s.life) this.sparks.splice(i, 1);
    }
    this.dispScore += (this.score - this.dispScore) * Math.min(1, 10 * rdt);
    const inD = this.anyDangerCells();
    if (inD && !this.danger) { this.danger = { t: this.settings.rescueDur, max: this.settings.rescueDur }; this.callout('DANGER! CLEAR THE LINE!', '#ff5b6b'); this.sfx('warn'); }
    else if (!inD && this.danger) this.danger = null;
    if (this.danger) { this.danger.t -= rdt; if (this.danger.t <= 0) b._dead = true; }
    this.fxTick();
  }
  stepLoose(b, dt) {
    for (let i = b.falling.length - 1; i >= 0; i--) { const f = b.falling[i];
      f.vy += 1900 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.a += f.spin * dt;
      if (f.y > this.H + 60) b.falling.splice(i, 1); }
    b.pops = b.pops.filter(p => this.now - p.t < 0.62);
    b.callouts = b.callouts.filter(c => this.now - c.t < 1.5);
    b.popups = b.popups.filter(p => this.now - p.t < 1.1);
    b.sparks = b.sparks.filter(s => this.now - s.t < s.life);
    b.ripples = b.ripples.filter(r => this.now - r.t < 0.45);
  }
  battleResolve(b) {
    const landed = this.batch; this.batch = []; this.resolveAt = 0;
    const results = [];
    for (const l of landed) {
      if (!this.grid.get(key(l.r, l.c))) { results.push({ popped: null, gone: true }); continue; }
      if (l.special === 'bomb') {
        const bx = this.cellX(l.r, l.c), by = this.cellY(l.r), blast = new Set([key(l.r, l.c)]);
        this.grid.forEach((g, kk) => { if (Math.hypot(this.cellX(g.r, g.c) - bx, this.cellY(g.r) - by) <= R * 4.3) blast.add(kk); });
        results.push({ popped: blast, bomb: true });
      } else {
        let kind = l.kind;
        if (l.special === 'rainbow') {
          let best = null, bs = 0;
          for (const [nr, nc] of this.neighbors(l.r, l.c)) { const nb = this.grid.get(key(nr, nc));
            if (nb && !nb.special) { const sz = this.matchGroup(l.r, l.c, nb.kind).size; if (sz > bs) { bs = sz; best = nb.kind; } } }
          if (best) kind = best; else { results.push({ popped: null }); continue; }
        }
        const g = this.matchGroup(l.r, l.c, kind);
        results.push({ popped: g.size >= 3 ? g : null });
      }
    }
    const allPopped = new Set(); let popN = 0;
    for (const r of results) if (r.popped) r.popped.forEach(kk => { if (!allPopped.has(kk) && this.grid.has(kk)) { allPopped.add(kk); popN++; } });
    allPopped.forEach(kk => {
      const g = this.grid.get(kk); this.grid.delete(kk);
      this.pops.push({ x: this.cellX(g.r, g.c), y: this.cellY(g.r), kind: g.kind, special: g.special, t: this.now,
        parts: Array.from({ length: 6 }, () => ({ a: rnd(0, 6.28), sp: rnd(100, 320), sz: rnd(3, 6.5) })) });
    });
    const dropped = this.supportCheck();
    this.updateLowest();
    if (popN > 0) {
      const pts = popN * 10;
      this.score += pts; this.addPopup(this.centerOf(allPopped), '+' + pts, '#17335c');
      b.player.stats.pops++; b.player.stats.bubbles += popN;
      this.missMeter = Math.max(0, this.missMeter - 1);
      this.sfx(popN >= 6 ? 'bigpop' : 'pop');
      if (results.some(r => r.bomb && r.popped)) this.callout('KABOOM!', '#ff8a3c');
    }
    let misses = 0;
    for (const r of results) if (!r.popped && !r.gone && !r.bomb) misses++;
    if (misses) { this.missMeter += misses;
      if (this.missMeter >= this.settings.missMax) { const pre = this.shake; this.ceilingDescend(); if (b.i !== this.battle.view) this.shake = pre; } }
    if (dropped.n > 0) {
      const pts = dropped.n * 30 + (dropped.n >= 5 ? 200 : 0);
      this.score += pts; b.player.stats.drops += dropped.n;
      this.addPopup({ x: dropped.x, y: dropped.y }, '+' + pts, '#ff8a3c');
      this.missMeter = Math.max(0, this.missMeter - 3);
      if (b.i === this.battle.view) this.shake = Math.min(14, 4 + dropped.n * 1.2);
      this.sfx('drop');
    }
    this.refreshQueues();
    const total = popN + (dropped.n || 0);
    if (total >= 6 && this.battle.phase === 'play') {
      const amount = clamp(2 + Math.round(total * 0.7), 3, 14);
      b.chargeFlash = this.now;
      if (b.player.bot) b.attackPend = { amount: (b.attackPend ? b.attackPend.amount : 0) + amount, t: rnd(0.7, 1.4) };
      else {
        const tg = this.battle.targeting;
        if (tg && tg.by === b.i) { tg.amount += amount; tg.t = tg.max; }
        else { this.battle.targeting = { by: b.i, amount, t: 6, max: 6, hover: -1 }; this.sfx('attackReady'); this.callout('BIG CLEAR! PICK A TARGET!', '#ff8a3c'); }
      }
    }
    if (this.grid.size === 0) {
      this.score += 1000; this.callout('FIELD CLEAR! +1000', '#3ecf72');
      this.gridTop = GRIDTOP0; this.gridTopTarget = GRIDTOP0;
      this.parityFlip = 0; this.anchorRow = 0; this.pressure = 0;
      const rows = this.levelRows();
      rows.forEach((row, r) => { for (let c = 0; c < row.length; c++)
        if (row[c] !== '.') this.grid.set(key(r, c), { r, c, kind: row[c], special: null, placedBy: -1,
          snapFrom: { x: this.cellX(r, c), y: this.cellY(r) - 500 }, snapT: this.now + r * 0.04 }); });
      this.updateLowest(); this.refreshQueues();
    }
  }
  deliverAttack(fromI, toI, amount) {
    const bt = this.battle; if (!bt) return;
    if (bt.targeting && bt.targeting.by === fromI) bt.targeting = null;
    const from = bt.boards[fromI], to = bt.boards[toI];
    if (!from || !to || !to.alive || fromI === toI) return;
    from.player.stats.attacks = (from.player.stats.attacks || 0) + 1;
    this.sfx('target');
    this.dumpGarbage(to, amount, fromI);
  }
  dumpGarbage(board, n, fromI) {
    this.bindBoard(board);
    let added = 0;
    for (let g = 0; g < n; g++) {
      const cand = [];
      const maxR = Math.floor((this.DANGER_Y - this.gridTop) / ROWH);
      for (let r = this.anchorRow; r <= maxR; r++) { const cn = this.colsIn(r);
        for (let c = 0; c < cn; c++) if (this.validCell(r, c)) cand.push({ r, c, jy: this.cellY(r) + rnd(0, ROWH * 2.2) }); }
      if (!cand.length) break;
      cand.sort((u, v) => v.jy - u.jy);
      const cell = cand[(Math.random() * Math.min(4, cand.length)) | 0];
      const kind = KINDS[(Math.random() * KINDS.length) | 0];
      this.grid.set(key(cell.r, cell.c), { r: cell.r, c: cell.c, kind, special: null, placedBy: -1,
        snapFrom: { x: this.cellX(cell.r, cell.c) + rnd(-40, 40), y: -60 - rnd(0, 160) }, snapT: this.now + g * 0.06 });
      added++;
    }
    this.updateLowest(); this.refreshQueues();
    this.callout(META[fromI].name + ' DUMPED ' + added + '!', '#ff5b6b');
    this.unbindBoard(board);
    board.attackFlash = this.now;
    if (board.i === this.battle.view) { this.shake = Math.min(14, 5 + added); this.sfx('junk'); }
  }
  eliminate(b) {
    const bt = this.battle;
    if (!b.alive) return;
    b.alive = false; b.danger = null; b.attackPend = null;
    bt.order.push(b.i);
    if (bt.targeting && bt.targeting.by === b.i) bt.targeting = null;
    this.bindBoard(b);
    this.grid.forEach(g => this.falling.push({ x: this.cellX(g.r, g.c), y: this.cellY(g.r),
      vx: rnd(-140, 140), vy: rnd(-260, -20), kind: g.kind, special: g.special, spin: rnd(-3, 3), a: 0 }));
    this.grid.clear();
    this.unbindBoard(b);
    if (b.i === bt.human.i) { bt.spectate = true; this.shake = 14; this.sfx('lose'); }
    else { bt.human.callouts.push({ text: b.meta.name + ' IS OUT!', color: '#7593b5', t: this.now }); this.sfx('drop'); }
  }
  endBattle(winner) {
    const bt = this.battle; if (bt.phase === 'over') return;
    bt.phase = 'over';
    if (winner) bt.order.push(winner.i);
    bt.winner = winner ? winner.i : -1;
    bt.targeting = null;
    this.state = winner && winner.i === bt.human.i ? 'won' : 'lost';
    this.sfx(this.state === 'won' ? 'win' : 'lose');
    this.showBattleEnd();
  }
  showBattleEnd() {
    const sh = this.shadowRoot, bt = this.battle;
    const places = [...bt.order].reverse();
    const hp = places.indexOf(bt.human.i) + 1;
    const t = sh.querySelector('.endTitle');
    t.textContent = this.state === 'won' ? '\ud83c\udfc6 Last one floating!' : 'Popped! You placed #' + hp;
    t.style.color = this.state === 'won' ? '#2b6fd4' : '#ff5b6b';
    sh.querySelector('.endSub').textContent = 'Battle royale \u00b7 ' + bt.boards.length + ' players';
    sh.querySelector('.endStats').innerHTML = places.map((pi, idx) => {
      const b = bt.boards[pi], st = b.player.stats;
      return `<div class="statRow"><span class="who" style="color:${b.meta.accent}">#${idx + 1}</span>
        <b style="width:90px">${this.escapeHTML(b.name||b.meta.name)}${pi === bt.human.i ? ' \u2b50' : ''}</b>
        <span class="nums">${Math.round(b.score).toLocaleString()} pts \u00b7 ${st.attacks || 0} attacks \u00b7 ${st.bubbles} popped</span></div>`;
    }).join('');
    const again = sh.querySelector('.again'); again.textContent = 'Battle again'; again.disabled = false;
    this.endEl.style.display = 'grid';
    this.showHighScores(Math.round(bt.human.score || 0));
  }
  battleSlots() {
    const n = this.battle.boards.length;
    const cols = n <= 4 ? 2 : n <= 6 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const areaY = 190, areaW = W - 52, areaH = this.H - 300;
    const gapX = 16, gapY = 46;
    let cw = (areaW - (cols - 1) * gapX) / cols, ch = cw * this.H / W;
    const totH = rows * ch + (rows - 1) * gapY;
    if (totH > areaH) { const k = areaH / totH; cw *= k; ch *= k; }
    const gw = cols * cw + (cols - 1) * gapX, gh = rows * ch + (rows - 1) * gapY;
    const ox = (W - gw) / 2, oy = areaY + (areaH - gh) / 2;
    return this.battle.boards.map((b, i) => {
      const r = (i / cols) | 0, c = i % cols;
      const lastRowN = n - (rows - 1) * cols;
      const rowOff = (r === rows - 1 && lastRowN < cols) ? (cols - lastRowN) * (cw + gapX) / 2 : 0;
      return { x: ox + rowOff + c * (cw + gapX), y: oy + r * (ch + gapY), w: cw, h: ch };
    });
  }
  battleSlotAt(pt) {
    const slots = this.battleSlots();
    for (let i = 0; i < slots.length; i++) { const s = slots[i];
      if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h + 34) return i; }
    return -1;
  }
  battleRender() {
    const ctx = this.ctx; if (!ctx) return;
    const bt = this.battle, vb = bt.boards[bt.view];
    this.bindBoard(vb);
    this.render();
    this.unbindBoard(vb);
    if (bt.zoom > 0.01) this.drawBattleZoom(ctx, bt.zoom);
  }
  drawBattleStrip(ctx) {
    const bt = this.battle, n = bt.boards.length;
    // 64 was a hand-measured clearance for the old fixed-size corner button.
    const x0 = this.chromeInset || X0, x1 = W - x0, gap = 5;
    const w = (x1 - x0 - (n - 1) * gap) / n, y = 8, h = 66;
    ctx.save();
    bt.boards.forEach((b, idx) => {
      const x = x0 + idx * (w + gap), cx = x + w / 2;
      ctx.globalAlpha = b.alive ? 1 : 0.55;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      this.rrect(ctx, x, y, w, h, 10); ctx.fill();
      ctx.fillStyle = b.meta.accent; ctx.fillRect(x + 4, y + 4, w - 8, 4);
      const af = this.now - b.attackFlash, cf = this.now - b.chargeFlash;
      if (b.alive && af >= 0 && af < 0.8) { ctx.globalAlpha = 1 - af / 0.8; ctx.lineWidth = 3; ctx.strokeStyle = '#ff5b6b'; this.rrect(ctx, x, y, w, h, 10); ctx.stroke(); ctx.globalAlpha = 1; }
      else if (b.alive && cf >= 0 && cf < 0.8) { ctx.globalAlpha = 1 - cf / 0.8; ctx.lineWidth = 3; ctx.strokeStyle = '#ff8a3c'; this.rrect(ctx, x, y, w, h, 10); ctx.stroke(); ctx.globalAlpha = 1; }
      else if (b.alive && b.danger) { ctx.globalAlpha = 0.5 + Math.sin(this.now * 9) * 0.4; ctx.lineWidth = 3; ctx.strokeStyle = '#ff5b6b'; this.rrect(ctx, x, y, w, h, 10); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.textAlign = 'center';
      ctx.font = '600 12px Fredoka, sans-serif';
      ctx.fillStyle = idx === bt.view ? '#2b6fd4' : '#7593b5';
      const rawName=b.name||b.meta.name,label=rawName.slice(0,n>4?6:12)+(idx===bt.view?' \u00b7 YOU':'')+(b.connected===false?' \u00b7 OFF':'');
      ctx.fillText(label, cx, y + 24);
      ctx.font = '700 17px Fredoka, sans-serif'; ctx.fillStyle = '#17335c';
      ctx.fillText(b.alive ? Math.round(b.dispScore).toLocaleString() : 'OUT', cx, y + 45);
      if (b.alive) {
        const frac = clamp(b.missMeter / this.settings.missMax, 0, 1);
        ctx.fillStyle = '#e3eefa'; this.rrect(ctx, x + 6, y + h - 12, w - 12, 5, 2.5); ctx.fill();
        if (frac > 0) { ctx.fillStyle = frac > 0.7 ? '#ff5b6b' : frac > 0.4 ? '#ffb054' : '#8fb6dd';
          this.rrect(ctx, x + 6, y + h - 12, Math.max(4, (w - 12) * frac), 5, 2.5); ctx.fill(); }
        if (b.perDrop) { // shots banked toward this board's next row push
          const pf = clamp((b.pressure || 0) / b.perDrop, 0, 1);
          ctx.fillStyle = '#e3eefa'; this.rrect(ctx, x + 6, y + h - 5, w - 12, 3, 1.5); ctx.fill();
          if (pf > 0) { ctx.fillStyle = pf > 0.8 ? '#ff5b6b' : '#b48ade';
            this.rrect(ctx, x + 6, y + h - 5, Math.max(3, (w - 12) * pf), 3, 1.5); ctx.fill(); }
        }
      }
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }
  drawBattleZoom(ctx, z) {
    const bt = this.battle, tg = bt.targeting;
    ctx.save();
    ctx.fillStyle = 'rgba(16,36,70,' + (0.62 * z).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, this.H);
    ctx.globalAlpha = z;
    ctx.textAlign = 'center';
    if (tg && tg.by === bt.human.i) {
      ctx.font = '700 44px Fredoka, sans-serif';
      ctx.lineWidth = 8; ctx.strokeStyle = '#fff';
      ctx.strokeText('CHOOSE YOUR TARGET!', W / 2, 120);
      ctx.fillStyle = '#ff8a3c'; ctx.fillText('CHOOSE YOUR TARGET!', W / 2, 120);
      ctx.font = '600 21px Fredoka, sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText('dump ' + tg.amount + ' junk bubbles \u00b7 tap a board or press its number', W / 2, 152);
      const k = clamp(tg.t / tg.max, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; this.rrect(ctx, W / 2 - 120, 164, 240, 8, 4); ctx.fill();
      ctx.fillStyle = '#ff8a3c'; this.rrect(ctx, W / 2 - 120, 164, Math.max(8, 240 * k), 8, 4); ctx.fill();
    } else {
      ctx.font = '700 40px Fredoka, sans-serif'; ctx.lineWidth = 8; ctx.strokeStyle = '#fff';
      ctx.strokeText('SPECTATING', W / 2, 120);
      ctx.fillStyle = '#9db8d4'; ctx.fillText('SPECTATING', W / 2, 120);
    }
    const slots = this.battleSlots();
    bt.boards.forEach((b, i) => {
      const s = slots[i];
      const mine = tg && tg.by === bt.human.i;
      const hov = mine && tg.hover === i && b.alive && i !== tg.by;
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2, sc = 0.85 + 0.15 * z;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
      this.renderMini(ctx, b, s, hov, tg);
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.font = '700 17px Fredoka, sans-serif';
      ctx.fillStyle = b.alive ? '#fff' : 'rgba(255,255,255,0.45)';
      ctx.fillText((b.name||b.meta.name) + (i === bt.human.i ? ' (YOU)' : '') + ' \u00b7 ' + Math.round(b.score).toLocaleString(), s.x + s.w / 2, s.y + s.h + 24);
      if (mine && b.alive && i !== tg.by) {
        ctx.fillStyle = hov ? '#ff8a3c' : 'rgba(255,255,255,0.92)';
        ctx.beginPath(); ctx.arc(s.x + 16, s.y + 16, 14, 0, 7); ctx.fill();
        ctx.fillStyle = hov ? '#fff' : '#17335c'; ctx.font = '700 16px Fredoka, sans-serif';
        ctx.fillText(String(i + 1), s.x + 16, s.y + 22);
      }
    });
    ctx.restore();
  }
  renderMini(ctx, b, s, hov, tg) {
    const k = s.w / W;
    this.bindBoard(b);
    ctx.save(); ctx.translate(s.x, s.y); ctx.scale(k, k);
    ctx.fillStyle = b.alive ? '#f2f8ff' : '#dfe7f0';
    this.rrect(ctx, 0, 0, W, this.H, 36); ctx.fill();
    const selectable = tg && tg.by === this.battle.human.i && b.alive && b.i !== tg.by;
    ctx.lineWidth = hov ? 16 : 8;
    ctx.strokeStyle = hov ? '#ff8a3c' : selectable ? b.meta.accent : 'rgba(120,150,190,0.5)';
    ctx.stroke();
    ctx.fillStyle = '#9fc4e8'; ctx.fillRect(18, 40, W - 36, Math.max(0, this.ceilingY() - 40));
    this.grid.forEach(g => {
      const x = this.cellX(g.r, g.c), y = this.cellY(g.r);
      ctx.fillStyle = g.special ? '#5b6f93' : PAL[g.kind];
      ctx.beginPath(); ctx.arc(x, y, R - 2, 0, 7); ctx.fill();
      ctx.strokeStyle = g.special ? '#2c3a52' : PALD[g.kind]; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, R - 3, 0, 7); ctx.stroke();
    });
    for (const f of this.flights) { ctx.fillStyle = PAL[f.kind] || '#fff'; ctx.beginPath(); ctx.arc(f.x, f.y, R - 4, 0, 7); ctx.fill(); }
    for (const f of this.falling) { ctx.globalAlpha = 0.7; ctx.fillStyle = PAL[f.kind] || '#fff'; ctx.beginPath(); ctx.arc(f.x, f.y, R - 4, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.setLineDash([18, 14]); ctx.lineWidth = 5; ctx.strokeStyle = b.danger ? '#ff5b6b' : 'rgba(255,91,107,0.5)';
    ctx.beginPath(); ctx.moveTo(18, this.DANGER_Y); ctx.lineTo(W - 18, this.DANGER_Y); ctx.stroke(); ctx.setLineDash([]);
    const p = b.player;
    ctx.save(); ctx.translate(p.x, this.LAUNCH_Y - 44); ctx.rotate(clamp(p.angle, -1.22, 1.22));
    ctx.fillStyle = b.meta.accent; this.rrect(ctx, -14, -70, 28, 52, 12); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, this.LAUNCH_Y - 44, 34, 0, 7); ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = b.meta.accent; ctx.beginPath(); ctx.arc(p.x, this.LAUNCH_Y - 44, 34, 0, 7); ctx.stroke();
    if (p.cur) { ctx.fillStyle = p.cur.special ? '#5b6f93' : PAL[p.cur.kind]; ctx.beginPath(); ctx.arc(p.x, this.LAUNCH_Y - 44, 22, 0, 7); ctx.fill(); }
    if (b.danger && b.alive) { ctx.fillStyle = 'rgba(255,91,107,' + (0.12 + Math.sin(this.now * 8) * 0.08).toFixed(3) + ')'; this.rrect(ctx, 0, 0, W, this.H, 36); ctx.fill(); }
    if (!b.alive) {
      ctx.fillStyle = 'rgba(60,80,110,0.55)'; this.rrect(ctx, 0, 0, W, this.H, 36); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 130px Fredoka, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('OUT', W / 2, this.H / 2 + 40);
    }
    const af = this.now - b.attackFlash;
    if (b.alive && af >= 0 && af < 0.7) { ctx.globalAlpha = 1 - af / 0.7; ctx.lineWidth = 22; ctx.strokeStyle = '#ff5b6b'; this.rrect(ctx, 8, 8, W - 16, this.H - 16, 30); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.restore();
    this.unbindBoard(b);
  }
  showTutorial() {
    const sh = this.shadowRoot, isB = this.settings.mode === 'battle';
    sh.querySelector('.tutSub').textContent = isB ? 'Battle royale \u00b7 2\u20138 players \u00b7 own field, shared chaos' : 'Co-op bubble shooter \u00b7 2\u20134 players \u00b7 one shared field';
    sh.querySelector('.coopSteps').style.display = isB ? 'none' : '';
    sh.querySelector('.battleSteps').style.display = isB ? '' : 'none';
    this.tutEl.style.display = 'grid'; this.state = 'tutorial';
  }

  /* ---------- DOM / UI ---------- */
  buildDOM() {
    const sh = this.attachShadow({ mode: 'open' });
    sh.innerHTML = `
<style>
:host{display:block;width:100%;height:100%;font-family:'Fredoka',sans-serif;color:#17335c}
:host(:fullscreen),:host(:-webkit-full-screen){width:100vw;height:100vh;height:100dvh;background:#cfe6ff}
*{box-sizing:border-box}
.root{--sideW:290px;--rootGap:20px;position:relative;display:flex;width:100%;height:100%;background:linear-gradient(#dbedff,#cfe6ff);align-items:center;justify-content:center;gap:var(--rootGap);overflow:hidden;
 padding:max(14px,env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left))}
/* relayout() sets the board's pixel size outright. Letterboxing it in pure CSS needs a
   definite height, and a definite height plus max-width makes the browser break the
   aspect ratio rather than shrink — hence the old viewport-unit calc(). The rules below
   are only the pre-measure first paint. */
.gameCol{position:relative;flex:none;height:100%;width:auto;max-width:100%;max-height:100%;aspect-ratio:var(--fieldAspect,.59259);min-width:0}
canvas{width:100%;height:100%;display:block;border-radius:22px;box-shadow:0 12px 40px rgba(40,80,140,.18);touch-action:none}
.pad{position:absolute;left:50%;transform:translateX(-50%);bottom:4px;display:flex;gap:10px;z-index:4}
/* The UA tap highlight is its own blue wash on top of ours, so an aim half tinted at 0%
   still flashed on touch. Ours is the only pressed feedback these controls get. */
.pad button{border:0;border-radius:12px;background:rgba(255,255,255,.94);box-shadow:0 4px 14px rgba(40,80,140,.25);font:inherit;font-weight:700;color:#2b4a70;cursor:pointer;padding:7px 20px;font-size:17px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.pad button:active{background:#2b6fd4;color:#fff}
/* The point-to-aim surface only exists on touch layouts in that mode; everywhere else it is
   absent from hit-testing entirely rather than merely transparent. */
.pad .padA{display:none;position:absolute;inset:0}
.pad .padF{background:#ff6fb1;color:#fff;font-size:14px;letter-spacing:.06em}
.pad .padS{font-size:19px;padding:7px 14px}
/* Which build is on screen, for telling a stale cached bundle from a fresh one. Sits
   under the pad's z-index and takes no pointer events, so it never eats an aim drag. */
.buildTag{position:absolute;right:8px;bottom:3px;z-index:3;pointer-events:none;user-select:none;
 font-size:clamp(8px,calc(10px * var(--u,1)),12px);letter-spacing:.02em;color:rgba(43,74,112,.38)}
.side{width:var(--sideW);flex:none;height:100%;overflow-y:auto;background:#fff;border-radius:20px;padding:18px;box-shadow:0 8px 30px rgba(40,80,140,.12);font-size:14px}
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
/* Cards are bounded by the board, which can be as narrow as ~300px on a cover screen, so
   they scale with --u and reflow off their own width via container queries rather than
   guessing at device breakpoints. */
.card{container-type:inline-size;background:#fff;border-radius:24px;padding:clamp(14px,calc(26px * var(--u,1)),30px) clamp(15px,calc(28px * var(--u,1)),32px);width:min(480px,92%);max-height:94%;overflow-y:auto;box-shadow:0 20px 60px rgba(20,40,80,.35)}
.card h1{margin:0 0 2px;font-size:clamp(20px,calc(30px * var(--u,1)),34px)}
.card .sub{color:#7593b5;margin:0 0 16px;font-size:clamp(13px,calc(15px * var(--u,1)),17px)}
.tut{display:flex;gap:12px;align-items:flex-start;margin:11px 0}
.tut .n{flex:none;width:30px;height:30px;border-radius:50%;background:#2b6fd4;color:#fff;display:grid;place-items:center;font-weight:700;font-size:15px}
.tut p{margin:3px 0 0;font-size:15px;line-height:1.35}
.tut b{color:#2b6fd4}
/* Overlay chrome is sized in board units (--u, published by fit()) so it stays in
   proportion on a 344px cover screen and a 900px desktop board alike, but clamped so
   touch targets never drop below ~36px. */
.cornerButton{position:absolute;top:var(--chromeGap);z-index:4;width:var(--chromeBtn);height:var(--chromeBtn);border-radius:50%;border:0;background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(40,80,140,.25);color:#2b4a70;font:700 clamp(16px,calc(22px * var(--u,1)),28px)/1 Fredoka,sans-serif;cursor:pointer;display:grid;place-items:center;touch-action:manipulation}
.gameCol{--chromeBtn:clamp(36px,calc(44px * var(--u,1)),56px);--chromeGap:clamp(6px,calc(10px * var(--u,1)),14px)}
.fullscreenButton{left:var(--chromeGap)}.fullscreenButton[hidden]{display:none}.gear{right:var(--chromeGap);display:none;font-size:clamp(15px,calc(20px * var(--u,1)),25px)}.fullscreenButton .exitIcon{display:none}.fullscreenButton.isFullscreen .enterIcon{display:none}.fullscreenButton.isFullscreen .exitIcon{display:inline}
.statRow{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:#f4f9ff;margin:6px 0;font-size:14px}
.statRow .who{font-weight:700;width:34px}
.statRow .nums{color:#5b7997;font-size:12.5px}
.hiscore{margin:14px 0 4px;text-align:left}
.hiscore h3{margin:0 0 8px;font-size:15px;color:#2b4a70}
.hsPrompt{display:block;font-size:13px;color:#2b6fd4;font-weight:700;margin-bottom:6px}
.hsSlots{display:flex;gap:8px;align-items:center;margin-bottom:10px}
.hsIn{width:110px;font:inherit;font-weight:700;font-size:22px;letter-spacing:.35em;text-align:center;text-transform:uppercase;padding:6px 4px 6px 10px;border:2px solid #c4ddf5;border-radius:12px;color:#17335c;background:#f9fcff}
.hsRow{display:flex;gap:10px;padding:5px 10px;border-radius:10px;font-size:13.5px;color:#2b4a70}
.hsRow:nth-child(odd){background:#f4f9ff}
.hsRow .rk{width:26px;color:#7593b5}
.hsRow .ini{font-weight:700;letter-spacing:.12em;width:46px}
.hsRow .pts{margin-left:auto;font-variant-numeric:tabular-nums}
.hsRow.you{background:#ffe9f3;color:#17335c}
.hsNote{font-size:12.5px;color:#7593b5;margin-top:6px}
.homeActions{display:grid;gap:9px;margin-top:18px}.joinFields{display:grid;grid-template-columns:1fr 110px;gap:8px;margin-top:12px}
.textInput{width:100%;border:2px solid #d7e6f5;border-radius:11px;padding:10px;font:inherit;color:#17335c;background:#f8fbff}
.lobbyCard{width:min(540px,92%)}.roomCode{font:700 52px ui-monospace,monospace;letter-spacing:.18em;text-align:center;color:#2b6fd4;margin:6px 0}
.onlinePlayers{display:grid;gap:6px;margin:12px 0}.onlinePlayer{display:flex;align-items:center;gap:9px;padding:8px 10px;background:#f4f9ff;border-radius:10px}
.statusDot{width:10px;height:10px;border-radius:50%;background:#3ecf72}.statusDot.off{background:#a9b8c8}.hostTag{margin-left:auto;color:#7593b5;font-size:12px}
.lobbySettings{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}.lobbySettings label{display:grid;gap:3px;font-size:12px;color:#7593b5}.lobbySettings select,.lobbySettings input,.lobbySettings textarea{border:2px solid #d7e6f5;border-radius:8px;padding:6px;font:inherit;color:#2b4a70;background:#f8fbff;min-width:0}
.lobbySettings .full{grid-column:1/-1}
@container (max-width:330px){.lobbySettings{grid-template-columns:1fr}.joinFields{grid-template-columns:1fr}.roomCode{font-size:38px}}.onlineBar{position:absolute;left:calc(var(--chromeBtn) + var(--chromeGap) * 2);right:calc(var(--chromeBtn) + var(--chromeGap) * 2);top:var(--chromeGap);z-index:4;display:none;gap:6px;pointer-events:none}.onlineBar button,.onlineBar span{pointer-events:auto;border:0;border-radius:10px;padding:7px 10px;background:rgba(255,255,255,.94);color:#2b4a70;font:600 12px Fredoka,sans-serif;box-shadow:0 3px 12px rgba(40,80,140,.18)}
.onlineBar .netState{margin-left:auto}.onlineBar .bad{color:#d13a4c}.formError{min-height:18px;color:#d13a4c;font-size:13px;margin-top:6px}.reconnect .card{text-align:center}
/* Whether the side panel fits is a question about the space left beside the board, not
   about viewport width, so relayout() sets .wideLayout and this rule follows it. That is
   what reclaims phone landscape and the unfolded Fold, where a viewport-width test failed. */
/* Padding is keyed to the viewport, never to .wideLayout: relayout() measures the padded
   box to make that decision, so letting the class change the padding would feed the
   decision back into its own input. */
@media (max-width:520px),(max-height:520px){.root{padding:max(6px,env(safe-area-inset-top)) max(6px,env(safe-area-inset-right)) max(6px,env(safe-area-inset-bottom)) max(6px,env(safe-area-inset-left))}}
.root:not(.wideLayout) .side{display:none}
.root:not(.wideLayout) .gear{display:grid}
.root:not(.wideLayout) .onlineBar{gap:4px}
.root:not(.wideLayout) .onlineBar .onlineRoomLabel{display:none}
.root:not(.wideLayout) .onlineBar button,.root:not(.wideLayout) .onlineBar span{padding:6px 7px;font-size:11px}
.root:not(.wideLayout) .side.open{display:block;position:absolute;right:8px;top:60px;bottom:8px;z-index:6;width:min(300px,80%)}
@media (hover:none) and (pointer:coarse){
 .pad{left:0;right:0;bottom:0;height:50%;transform:none;display:block;pointer-events:none}
 .pad button{pointer-events:auto}
 .pad .padL,.pad .padR{position:absolute;bottom:0;width:50%;height:100%;padding:0 calc(24px * var(--u,1)) calc(24px * var(--u,1));border-radius:0;background:transparent;box-shadow:none;color:rgba(43,74,112,.48);display:flex;align-items:flex-end;font-size:clamp(18px,calc(26px * var(--u,1)),34px)}
 .pad .padL{left:0;justify-content:flex-start}
 .pad .padR{right:0;justify-content:flex-end}
 /* At 0% the whole pressed state goes away, arrow ink included, so "off" really is
    invisible rather than merely a fainter wash. */
 .pad .padL:active,.pad .padR:active{background:rgba(43,111,212,var(--padTint,.025));color:var(--padInk,#2b6fd4)}
 /* --fireScale multiplies the whole button, so the label and the tap target grow
    together and the swap button slides out of the way instead of being overlapped. */
 .pad .padF{position:absolute;left:50%;bottom:calc(18px * var(--u,1));z-index:2;transform:translateX(-50%);padding:calc(12px * var(--u,1) * var(--fireScale,1)) calc(28px * var(--u,1) * var(--fireScale,1));font-size:calc(clamp(11px,calc(14px * var(--u,1)),19px) * var(--fireScale,1));border-radius:calc(14px * var(--fireScale,1));box-shadow:0 4px 14px rgba(40,80,140,.25)}
 /* Sits on top of the .padR aim overlay rather than beside it, so the aim halves stay
    full width and the swap target still wins the pointer where they overlap. */
 .pad .padS{position:absolute;left:50%;bottom:calc(18px * var(--u,1));z-index:3;transform:translateX(calc(-50% + 92px * var(--u,1) * var(--fireScale,1)));padding:calc(11px * var(--u,1)) calc(15px * var(--u,1));font-size:clamp(15px,calc(19px * var(--u,1)),25px);border-radius:14px;box-shadow:0 4px 14px rgba(40,80,140,.25)}
 /* Point-to-aim replaces the two halves with one surface over the whole board: you aim by
    touching where you want the shot to go, so the surface has to reach the targets, not just
    the thumb rest. FIRE and swap keep their z-index above it, and padHit checks them first
    anyway, so the only thing that changes is what an otherwise-unclaimed touch means. */
 .root[data-aim-mode="point"] .pad{top:0;height:100%}
 .root[data-aim-mode="point"] .pad .padA{display:block;pointer-events:auto;background:transparent}
 .root[data-aim-mode="point"] .pad .padA:active{background:rgba(43,111,212,var(--padTint,.025))}
 .root[data-aim-mode="point"] .pad .padL,.root[data-aim-mode="point"] .pad .padR{display:none}
 /* The aim surface reaches the top of the board, where the chrome lives, and shares the pad's
    stacking level — so lift the chrome above it or a full-board drag would eat every button. */
 .root[data-aim-mode="point"] .cornerButton,.root[data-aim-mode="point"] .onlineBar{z-index:5}
}
</style>
<div class="root">
  <div class="gameCol">
    <canvas></canvas>
    <button class="cornerButton fullscreenButton" type="button" title="Enter fullscreen" aria-label="Enter fullscreen"><span class="enterIcon" aria-hidden="true">\u26f6</span><span class="exitIcon" aria-hidden="true">\u2715</span></button>
    <button class="cornerButton gear" type="button" title="Settings" aria-label="Open settings">\u2699</button>
    <div class="onlineBar"><span class="onlineRoomLabel"></span><button class="onlinePause">Pause</button><button class="onlineRestart">Restart</button><button class="onlineLeave">Leave</button><span class="netState">Live</span></div>
    <div class="buildTag">${BUILD_LABEL}</div>
    <div class="pad"><div class="padA" aria-hidden="true"></div><button class="padL">\u25c0</button><button class="padS" title="Swap loaded and next bubble">\u21c4</button><button class="padF">FIRE</button><button class="padR">\u25b6</button></div>
    <div class="overlay home"><div class="card">
      <h1>Bubble Together</h1><p class="sub">Play together on one device or live across different devices.</p>
      <label>Display name<input class="textInput playerName" maxlength="16" placeholder="Your name" autocomplete="nickname"></label>
      <div class="homeActions"><button class="btn primary createOnline">Create online room</button>
      <div class="joinFields"><button class="btn ghost joinOnline" style="margin:0">Join online room</button><input class="textInput roomInput" inputmode="numeric" maxlength="3" placeholder="123" aria-label="Room code"></div>
      <button class="btn ghost localPlay">Local play</button></div><div class="formError"></div>
    </div></div>
    <div class="overlay lobby" style="display:none"><div class="card lobbyCard">
      <h1>Online lobby</h1><p class="sub" style="margin-bottom:4px">Room code</p><div class="roomCode"></div>
      <div class="onlinePlayers"></div>
      <h3>Host settings</h3><div class="lobbySettings">
        <label>Mode<select data-setting="mode"><option value="clear">Co-op Clear</option><option value="endless">Endless</option><option value="battle">Battle Royale (2\u20138)</option></select></label>
        <label>Field<select data-setting="field"><option value="classic">Classic</option><option value="wide">Wide 4×</option></select></label>
        <label>Level<select data-setting="level"><option value="0">1. The Vault</option><option value="1">2. Chandeliers</option><option value="2">3. The Canyon</option><option value="3">4. Hive Bridge</option><option value="custom">Custom</option></select></label>
        <label>Aim guide<select data-setting="guide"><option value="1">Full path</option><option value="0.5">Short</option><option value="0.25">Tiny</option></select></label>
        <label>Reload<input data-setting="reload" type="range" min="0.8" max="2.2" step="0.05"></label>
        <label>Miss limit<input data-setting="missMax" type="range" min="4" max="20" step="1"></label>
        <label>Shot pressure<input data-setting="pressureShots" type="range" min="0" max="20" step="1"></label>
        <label>Rescue timer<input data-setting="rescueDur" type="range" min="3" max="5" step="0.5"></label>
        <label>Aim assist<input data-setting="assist" type="range" min="0" max="1" step="0.05"></label>
        <label>Aim speed<input data-setting="aimSpeed" type="range" min="0.6" max="6" step="0.1"></label>
        <label>Touch tint<input data-setting="padTint" type="range" min="0" max="0.3" step="0.005"></label>
        <label>FIRE size<input data-setting="fireScale" type="range" min="0.6" max="2.2" step="0.05"></label>
        <label>Teammate lines<select data-setting="mateLines"><option value="true">Show</option><option value="false">Hide</option></select></label>
        <label>Sound<select data-setting="sound"><option value="true">On</option><option value="false">Off</option></select></label>
        <label class="full customSetting">Custom level<textarea data-setting="customText" rows="4" maxlength="512" spellcheck="false"></textarea></label>
      </div><div class="formError lobbyError"></div><button class="btn primary lobbyStart">Start match</button><button class="btn ghost lobbyLeave">Leave room</button>
    </div></div>
    <div class="overlay reconnect" style="display:none"><div class="card"><h1>Reconnecting…</h1><p class="sub">Your launcher is reserved while we reconnect.</p><button class="btn ghost reconnectLeave">Leave room</button></div></div>
    <div class="overlay tutorial" style="display:none"><div class="card">
      <h1>Bubble Together</h1>
      <p class="sub tutSub">Co-op bubble shooter \u00b7 2\u20134 players \u00b7 one shared field</p>
      <div class="coopSteps">
      <div class="tut"><div class="n">1</div><p><b>Aim &amp; shoot.</b> <span class="tutAim"></span> P2: A/D + Space. P3: arrows + Enter. P4: J/L + K.</p></div>
      <div class="tut"><div class="n">2</div><p><b>Match 3+</b> bubbles of the same color to pop them.</p></div>
      <div class="tut"><div class="n">3</div><p>Bubbles cut off from the ceiling <b>fall</b> \u2014 big drops score big.</p></div>
      <div class="tut"><div class="n">4</div><p><b>Everyone shares the same field</b> \u2014 set up matches for each other for Assists and Team Chains.</p></div>
      <div class="tut"><div class="n">5</div><p>Flying shots <b>pass through</b> each other \u2014 fire whenever you're ready.</p></div>
      <div class="tut"><div class="n">6</div><p>If bubbles cross the <b>danger line</b>, clear them before the rescue timer hits zero!</p></div>
      </div>
      <div class="battleSteps" style="display:none">
      <div class="tut"><div class="n">1</div><p><b>Your own field.</b> Same aim &amp; fire controls \u2014 but every player gets a private board.</p></div>
      <div class="tut"><div class="n">2</div><p><b>Match 3+</b> to pop \u00b7 cut supports to drop whole chunks.</p></div>
      <div class="tut"><div class="n">3</div><p>Clear <b>6+ bubbles at once</b> to charge an <b>ATTACK</b> \u2014 the arena zooms out live.</p></div>
      <div class="tut"><div class="n">4</div><p><b>Pick your victim.</b> Tap a rival's board (or press their number) to dump junk bubbles on them.</p></div>
      <div class="tut"><div class="n">5</div><p>Junk rains onto their pile. Past the <b>danger line</b> = eliminated.</p></div>
      <div class="tut"><div class="n">6</div><p><b>Last one floating wins.</b> Up to 8 players per arena.</p></div>
      </div>
      <button class="btn primary start">Start playing</button>
    </div></div>
    <div class="overlay pause" style="display:none"><div class="card" style="text-align:center">
      <h1>Paused</h1><p class="sub">press P or the button to resume</p>
      <button class="btn primary resume">Resume</button>
    </div></div>
    <div class="overlay levelUp" style="display:none"><div class="card">
      <h1 class="luTitle"></h1><p class="sub luSub"></p>
      <button class="btn primary luNext">Next level</button>
    </div></div>
    <div class="overlay end" style="display:none"><div class="card">
      <h1 class="endTitle"></h1><p class="sub endSub"></p>
      <div class="endStats"></div>
      <div class="hiscore" style="display:none">
        <h3 class="hsTitle">High scores</h3>
        <div class="hsEntry" style="display:none">
          <span class="hsPrompt">New high score! Enter your initials</span>
          <div class="hsSlots"><input class="hsIn" maxlength="3" autocomplete="off" spellcheck="false" aria-label="Initials"><button class="btn primary hsSave">Save</button></div>
        </div>
        <div class="hsList"></div>
        <div class="hsNote"></div>
      </div>
      <button class="btn primary again">Play again</button>
    </div></div>
  </div>
  <div class="side"></div>
</div>`;
    this.canvas = sh.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.rootEl = sh.querySelector('.root');
    this.gameColEl = sh.querySelector('.gameCol');
    this.tutEl = sh.querySelector('.tutorial');
    this.homeEl = sh.querySelector('.home');
    this.lobbyEl = sh.querySelector('.lobby');
    this.reconnectEl = sh.querySelector('.reconnect');
    this.pauseEl = sh.querySelector('.pause');
    this.endEl = sh.querySelector('.end');
    this.levelUpEl = sh.querySelector('.levelUp');
    this.sideEl = sh.querySelector('.side');
    this.applyTouchStyle();
    sh.querySelector('.localPlay').onclick = () => { this.online=false; this.homeEl.style.display='none'; this.showTutorial(); };
    sh.querySelector('.createOnline').onclick = () => this.beginOnline('create');
    sh.querySelector('.joinOnline').onclick = () => this.beginOnline('join');
    sh.querySelector('.roomInput').addEventListener('input', e => e.target.value=e.target.value.replace(/\D/g,'').slice(0,3));
    sh.querySelector('.start').onclick = () => { this.ensureAudio(); if (this.settings.mode === 'battle' && !this.battle) this.resetGame(); this.state = 'play'; this._t = performance.now(); this.tutEl.style.display = 'none'; };
    sh.querySelector('.resume').onclick = () => this.togglePause();
    sh.querySelector('.again').onclick = () => { if(this.online){if(this.isOnlineHost())this.sendOnline('return_to_lobby');}else{
      // A finished level chain leaves settings.level on the last level; restart the run.
      if (this._runStartLevel !== undefined) { this.settings.level = this._runStartLevel; this._syncSettings?.(); }
      this.state = 'play'; this.resetGame(); } };
    sh.querySelector('.luNext').onclick = () => this.advanceLevel();
    sh.querySelector('.gear').onclick = () => this.sideEl.classList.toggle('open');
    const fullscreenButton = sh.querySelector('.fullscreenButton');
    this.fullscreenButtonEl = fullscreenButton;
    this.gearEl = sh.querySelector('.gear');
    const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
    const syncFullscreenButton = () => {
      const active = fullscreenElement() === this;
      fullscreenButton.classList.toggle('isFullscreen', active);
      fullscreenButton.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
      fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    };
    fullscreenButton.onclick = async () => {
      try {
        if (fullscreenElement()) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) await exit.call(document);
        } else {
          const enter = this.requestFullscreen || this.webkitRequestFullscreen;
          if (enter) await enter.call(this);
        }
      } catch (_) {}
      syncFullscreenButton();
    };
    document.addEventListener('fullscreenchange', syncFullscreenButton);
    document.addEventListener('webkitfullscreenchange', syncFullscreenButton);
    this._fullscreenUnbind = () => {
      document.removeEventListener('fullscreenchange', syncFullscreenButton);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenButton);
    };
    if (!(this.requestFullscreen || this.webkitRequestFullscreen)) fullscreenButton.hidden = true;
    syncFullscreenButton();
    /* One capture-phase router owns every touch on the pad, so which control wins is a
       property of padHit's order rather than of CSS stacking. The aim halves are transparent
       full-height overlays, so before this a thumb landing a few pixels off FIRE turned the
       launcher instead of shooting — the commonest mis-hit on a phone. */
    const pad = this.padEl = sh.querySelector('.pad');
    pad.addEventListener('pointerdown', e => {
      const hit = this.padHit(e.clientX, e.clientY); if (!hit) return;
      e.preventDefault(); e.stopPropagation(); this.ensureAudio();
      try { pad.setPointerCapture(e.pointerId); } catch (_) {}
      const hold = this._padHold = { id: e.pointerId, hit, p: null };
      if (hit === 'fire') this.padFire();
      else if (hit === 'swap') this.padSwap();
      else if (hit === 'aim') { if (this.battleTargetActive()) this.battlePickAt(e); else this.padAimPoint(e); }
      else hold.p = this.padAimHold(hit, true);
    }, true);
    pad.addEventListener('pointermove', e => {
      const hold = this._padHold;
      if (!hold || hold.id !== e.pointerId || hold.hit !== 'aim') return;
      e.preventDefault();
      if (this.battleTargetActive()) this.battleHoverAt(e); else this.padAimPoint(e);
    }, true);
    const padRelease = e => {
      const hold = this._padHold;
      if (!hold || (e && e.pointerId !== undefined && hold.id !== e.pointerId)) return;
      this._padHold = null;
      if (hold.hit === 'aim') this.padAimPoint(null);
      else if (hold.hit === 'l' || hold.hit === 'r') this.padAimHold(hold.hit, false, hold.p);
    };
    pad.addEventListener('pointerup', padRelease, true);
    pad.addEventListener('pointercancel', padRelease, true);
    pad.addEventListener('pointerleave', padRelease, true); // fallback where capture is unavailable
    sh.querySelector('.lobbyStart').onclick=()=>this.sendOnline('start');
    sh.querySelector('.lobbyLeave').onclick=()=>this.leaveOnline();
    sh.querySelector('.reconnectLeave').onclick=()=>this.leaveOnline();
    sh.querySelector('.onlineLeave').onclick=()=>this.leaveOnline();
    sh.querySelector('.onlinePause').onclick=()=>this.togglePause();
    sh.querySelector('.onlineRestart').onclick=()=>{if(this.isOnlineHost()&&confirm('Restart the match for everyone?'))this.sendOnline('restart');};
    sh.querySelectorAll('.lobbySettings [data-setting]').forEach(el=>el.addEventListener('change',()=>this.pushLobbySettings()));
    /* Observe .root (the available box) for the world-height decision and .gameCol (the
       result of that decision) only for the backing-store resize. Keeping the two apart
       is what stops the observer from feeding its own output back in. */
    this._availObserver = new ResizeObserver(() => this.measure());
    this._availObserver.observe(this.rootEl);
    this._resizeObserver = new ResizeObserver(() => this.fit());
    this._resizeObserver.observe(this.gameColEl);
    /* A fold/unfold or an address bar sliding away does not reliably resize an element
       whose own size is percentage-derived, so listen for the viewport directly too. */
    const onViewport = () => this.measure();
    window.addEventListener('orientationchange', onViewport);
    window.visualViewport?.addEventListener('resize', onViewport);
    this._viewportUnbind = () => {
      window.removeEventListener('orientationchange', onViewport);
      window.visualViewport?.removeEventListener('resize', onViewport);
    };
    this.measure();
    this.buildSettings();
  }

  /* ---------- layout ---------- */
  /* Available space picks the world height; the world height sets the CSS aspect ratio.
     Offline that chain runs live; online the room's viewH wins so every player shares
     one danger line, and a mismatched device simply letterboxes. */
  measure() {
    const root = this.rootEl; if (!root) return;
    const cs = getComputedStyle(root);
    const availW = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = root.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (!(availW > 0 && availH > 0)) return;
    this._avail = { w: availW, h: availH,
      sideW: parseFloat(cs.getPropertyValue('--sideW')) || 290,
      gap: parseFloat(cs.getPropertyValue('--rootGap')) || 20 };
    this._deviceViewH = geom(W * availH / availW).H;
    if (!this.online) this.setViewH(this._deviceViewH);
    this.relayout();
  }
  relayout() {
    const root = this.rootEl, col = this.gameColEl, a = this._avail;
    if (!root || !col || !a) return;
    root.style.setProperty('--fieldAspect', (W / this.H).toFixed(5));
    /* One pass, no oscillation. Decide on the side panel from the board as it would be
       with no panel; because the panel only appears with 300px+ to spare, the board is
       already height-limited by then, so reserving the panel cannot shrink it and flip
       the decision back. Wide and near-square screens — phone landscape, an unfolded
       Fold — spend that space on UI instead of empty gradient. */
    const wide = a.w - Math.min(a.w, a.h * W / this.H) >= 300;
    root.classList.toggle('wideLayout', wide);
    const usableW = wide ? a.w - a.sideW - a.gap : a.w;
    const boardW = Math.max(1, Math.min(usableW, a.h * W / this.H));
    col.style.width = boardW + 'px';
    col.style.height = boardW * this.H / W + 'px';
    this.fit();
  }
  fit() {
    const el = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth || 320;
    el.width = Math.round(w * dpr); el.height = Math.round(w * dpr * this.H / W);
    /* One unit of "board scale" so overlay chrome can track the board instead of the
       page — a 44px button is huge on a 344px cover screen and lost on a 900px one. */
    this.gameColEl?.style.setProperty('--u', (w / W).toFixed(4));
    /* The corner buttons are DOM overlays with a minimum tap size, so on a narrow board
       they cover more of the world than their nominal 44px. Measure one of them and let
       the canvas HUD inset itself to match rather than being drawn underneath. */
    const btn = [this.fullscreenButtonEl, this.gearEl].find(el => el && el.offsetWidth > 0);
    const gap = btn ? Math.min(btn.offsetLeft, w - btn.offsetLeft - btn.offsetWidth) : 0;
    this.chromeInset = btn ? Math.max(X0, (btn.offsetWidth + gap * 2) * W / w) : X0;
  }
  hideOverlays() { this.pauseEl.style.display = 'none'; this.endEl.style.display = 'none'; this.levelUpEl.style.display = 'none'; }
  showEnd(won) {
    const sh = this.shadowRoot;
    sh.querySelector('.endTitle').textContent = won ? '\u2b50 Field cleared!' : 'The bubbles won\u2026';
    sh.querySelector('.endTitle').style.color = won ? '#2b6fd4' : '#ff5b6b';
    sh.querySelector('.endSub').textContent = 'Team score: ' + this.score.toLocaleString();
    sh.querySelector('.endStats').innerHTML = this.players.map(p =>
      `<div class="statRow"><span class="who" style="color:${p.meta.accent}">${p.meta.name}</span>
       <span class="nums">${p.stats.pops} pops \u00b7 ${p.stats.bubbles} bubbles \u00b7 ${p.stats.assists} assists \u00b7 ${p.stats.drops} dropped \u00b7 ${p.stats.rescues} rescues</span></div>`).join('');
    const againBtn = sh.querySelector('.again'); if (!this.online) { againBtn.textContent = 'Play again'; againBtn.disabled = false; }
    this.endEl.style.display = 'grid';
    this.showHighScores(this.score);
    if(this.online){const button=this.shadowRoot.querySelector('.again');button.textContent=this.isOnlineHost()?'Return to lobby':'Waiting for host';button.disabled=!this.isOnlineHost();}
  }

  /* ---------- high scores ----------
     The table lives on the game server (same origin, /scores) so it is shared across
     devices and survives a reload. Every call fails soft: an unreachable server must
     never keep the game-over card from rendering. */
  scoreBucket() {
    const mode = this.settings.mode;
    // Clear mode chains levels, so a run is filed under the level it started on.
    return { mode, level: mode === 'clear' ? (this._runStartLevel ?? this.settings.level) : 0 };
  }
  async showHighScores(score) {
    const sh = this.shadowRoot, wrap = sh.querySelector('.hiscore');
    const entryEl = sh.querySelector('.hsEntry'), listEl = sh.querySelector('.hsList'), noteEl = sh.querySelector('.hsNote');
    wrap.style.display = ''; entryEl.style.display = 'none'; noteEl.textContent = '';
    listEl.innerHTML = '<div class="hsNote">Loading…</div>';
    const bucket = this.scoreBucket();
    let entries;
    try {
      const res = await fetch(`/scores?mode=${encodeURIComponent(bucket.mode)}&level=${encodeURIComponent(bucket.level)}`, { cache:'no-store' });
      if (!res.ok) throw new Error('bad status');
      entries = (await res.json()).entries || [];
    } catch (e) {
      listEl.innerHTML = ''; noteEl.textContent = 'Leaderboard unavailable.'; return;
    }
    this.renderHighScores(entries);
    const qualifies = score > 0 && (entries.length < 20 || score > entries[entries.length - 1].score);
    if (!qualifies) return;
    entryEl.style.display = '';
    const input = sh.querySelector('.hsIn'), save = sh.querySelector('.hsSave');
    try { input.value = localStorage.getItem('bt_initials') || ''; } catch (e) {}
    input.focus(); input.select();
    save.disabled = false;
    const submit = async () => {
      const initials = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      if (!initials) { noteEl.textContent = 'Enter 1-3 letters or digits.'; return; }
      save.disabled = true;
      try { localStorage.setItem('bt_initials', initials); } catch (e) {}
      try {
        const res = await fetch('/scores', { method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify({ initials, score, mode: bucket.mode, level: bucket.level }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'rejected');
        entryEl.style.display = 'none';
        noteEl.textContent = 'Ranked #' + data.rank + '.';
        this.renderHighScores(data.entries, data.rank);
      } catch (e) {
        save.disabled = false; noteEl.textContent = 'Could not save that score.';
      }
    };
    save.onclick = submit;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  }
  renderHighScores(entries, mine = 0) {
    const listEl = this.shadowRoot.querySelector('.hsList');
    if (!entries.length) { listEl.innerHTML = '<div class="hsNote">No scores yet — be the first.</div>'; return; }
    listEl.innerHTML = entries.map((e, i) =>
      `<div class="hsRow${i + 1 === mine ? ' you' : ''}"><span class="rk">${i + 1}</span><span class="ini">${
        String(e.initials).replace(/[^A-Z0-9]/gi, '')}</span><span class="pts">${Number(e.score).toLocaleString()}</span></div>`).join('');
  }

  /* ---------- online rooms ---------- */
  isOnlineHost(){return !!this.onlineRoom&&this.onlineRoom.hostId===this.onlinePlayerId;}
  beginOnline(action){
    const sh=this.shadowRoot,name=sh.querySelector('.playerName').value.trim(),code=sh.querySelector('.roomInput').value;
    const err=sh.querySelector('.home .formError');err.textContent='';
    if(!name){err.textContent='Enter a display name.';return;}if(action==='join'&&!/^\d{3}$/.test(code)){err.textContent='Enter a three-digit room code.';return;}
    this.ensureAudio();this.online=true;this.sideEl.style.display='none';this._pendingOnline={action,name,code};this.openOnlineSocket();
  }
  openOnlineSocket(rejoin=false){
    clearTimeout(this._reconnectTimer);const protocol=location.protocol==='https:'?'wss:':'ws:';const ws=new WebSocket(protocol+'//'+location.host+'/ws');this.ws=ws;
    ws.onopen=()=>{this.setNetworkState('Live');if(rejoin&&this._onlineToken)this.sendOnline('rejoin',{code:this._onlineCode,token:this._onlineToken});else if(this._pendingOnline)this.sendOnline(this._pendingOnline.action,{name:this._pendingOnline.name,code:this._pendingOnline.code});};
    ws.onmessage=e=>{let msg;try{msg=JSON.parse(e.data);}catch(_){return;}this.handleOnlineMessage(msg);};
    ws.onclose=()=>{if(!this.online||this._leaving)return;this._onlineHeld={l:false,r:false};this.setNetworkState('Offline',true);this.reconnectEl.style.display='grid';this._reconnectTimer=setTimeout(()=>this.openOnlineSocket(true),Math.min(10000,500*Math.pow(2,this._reconnectAttempts=(this._reconnectAttempts||0)+1)),);};
  }
  sendOnline(type,payload={}){if(this.ws&&this.ws.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({type,...payload}));}
  handleOnlineMessage(msg){
    const sh=this.shadowRoot;
    if(msg.type==='error'){
      const target=this.lobbyEl.style.display!=='none'?sh.querySelector('.lobbyError'):sh.querySelector('.home .formError');target.textContent=msg.message;
      if(['room_gone','bad_token'].includes(msg.code)){this.clearOnlineSession();this.returnHome();}return;
    }
    if(msg.type==='joined'){
      this._reconnectAttempts=0;this.reconnectEl.style.display='none';this.onlinePlayerId=msg.playerId;this.onlineRoom=msg.room;this._onlineCode=msg.room.code;this._onlineToken=msg.token;
      try{localStorage.setItem('bt_online_session',JSON.stringify({code:this._onlineCode,token:this._onlineToken}));}catch(_){}
      this.sideEl.style.display='none';this.homeEl.style.display='none';if(msg.snapshot){this.lobbyEl.style.display='none';this._runStartLevel=msg.snapshot?.settings?.level??0;this.applyOnlineSnapshot(msg.snapshot);}else this.showOnlineLobby();return;
    }
    if(msg.type==='lobby_state'){this.onlineRoom=msg.room;if(msg.room.phase==='lobby')this.showOnlineLobby();return;}
    if(msg.type==='host_changed'){if(this.onlineRoom)this.onlineRoom.hostId=msg.hostId;this.syncOnlineControls();return;}
    if(msg.type==='match_started'){this.onlineRoom=msg.room;this.lobbyEl.style.display='none';this.endEl.style.display='none';
      // Snapshots overwrite settings.level as the server walks the chain, so pin the
      // level this run started on for the leaderboard bucket.
      this._runStartLevel=msg.snapshot?.settings?.level??0;this.applyOnlineSnapshot(msg.snapshot);this.shadowRoot.querySelector('.onlineBar').style.display='flex';return;}
    if(msg.type==='snapshot'){if(msg.phase==='ended'&&this.onlineRoom)this.onlineRoom.phase='ended';this.applyOnlineSnapshot(msg.snapshot);return;}
    if(msg.type==='phase_changed'){this.state=msg.phase;this.pauseEl.style.display=msg.phase==='paused'?'grid':'none';this.syncOnlineControls();return;}
    if(msg.type==='left'){this.returnHome();}
  }
  showOnlineLobby(){
    const sh=this.shadowRoot,room=this.onlineRoom;if(!room)return;this.state='lobby';this.homeEl.style.display='none';this.tutEl.style.display='none';this.endEl.style.display='none';this.pauseEl.style.display='none';this.reconnectEl.style.display='none';this.lobbyEl.style.display='grid';sh.querySelector('.onlineBar').style.display='none';
    sh.querySelector('.roomCode').textContent=room.code;sh.querySelector('.onlinePlayers').innerHTML=room.players.map((p,i)=>`<div class="onlinePlayer"><span class="pDot" style="background:${META[i].accent}"></span><span>${this.escapeHTML(p.name)}</span><span class="statusDot ${p.connected?'':'off'}"></span>${p.id===room.hostId?'<span class="hostTag">HOST</span>':''}</div>`).join('');
    const host=this.isOnlineHost(),settings=room.settings,battle=settings.mode==='battle';sh.querySelectorAll('.lobbySettings [data-setting]').forEach(el=>{const k=el.dataset.setting,v=settings[k];el.disabled=!host;el.value=typeof v==='boolean'?String(v):String(v??'');if(['field','mateLines'].includes(k))el.closest('label').style.display=battle?'none':'';});
    /* The host's screen shape is a room setting, so publish it on arrival — otherwise a
       host who never touches a slider would silently hand everyone the 1080 default. */
    if(host&&room.phase==='lobby'&&this._deviceViewH&&settings.viewH!==this._deviceViewH)this.pushLobbySettings();
    sh.querySelector('.customSetting').style.display=settings.level==='custom'?'grid':'none';const start=sh.querySelector('.lobbyStart');start.style.display=host?'block':'none';start.disabled=room.players.filter(p=>p.connected).length<2;sh.querySelector('.lobbyError').textContent=host?'':'Waiting for the host to start.';
  }
  pushLobbySettings(){
    if(!this.isOnlineHost()||!this.onlineRoom)return;const next={...this.onlineRoom.settings};this.shadowRoot.querySelectorAll('.lobbySettings [data-setting]').forEach(el=>{let v=el.value;if(['reload','missMax','rescueDur','assist','pressureShots','guide','aimSpeed','padTint','fireScale'].includes(el.dataset.setting))v=Number(v);if(['mateLines','sound'].includes(el.dataset.setting))v=v==='true';if(el.dataset.setting==='level'&&v!=='custom')v=Number(v);next[el.dataset.setting]=v;});next.viewH=this._deviceViewH||H0;this.sendOnline('update_settings',{revision:this.onlineRoom.revision,settings:next});
  }
  /* Rebuild a launcher from a snapshot without stamping on the angle we are already showing:
     the wire value becomes serverAngle and predictOwnAim / followServerAim ease onto it. Seat
     identity has to match or the carried angle belongs to somebody else. */
  playerFromSnapshot(p,i,old){
    const keep=old&&old.id===p.id;
    return {...p,i,meta:META[i],bot:false,held:keep?old.held:{},serverAngle:p.angle,
      angle:keep?old.angle:p.angle,aimVel:keep?old.aimVel:0,aimTarget:keep?old.aimTarget:null};
  }
  applyOnlineSnapshot(s){
    if(s.kind==='battle'){this.applyOnlineBattleSnapshot(s);return;}
    const oldState=this.state;this.settings={...this.settings,...s.settings};this.applyRoomControls();if(this.setViewH(this.settings.viewH??H0))this.relayout();this.WW=s.WW;this.cols=s.cols;this.parityFlip=s.parityFlip;this.anchorRow=s.anchorRow||0;this.gridTop=s.gridTop;this.gridTopTarget=s.gridTopTarget;this.lowestY=s.lowestY;this.grid=new Map(s.grid.map(b=>[key(b.r,b.c),b]));this.flights=s.flights||[];
    this.players=(s.players||[]).map((p,i)=>this.playerFromSnapshot(p,i,this.players?.[i]));this.activeP=Math.max(0,this.players.findIndex(p=>p.id===this.onlinePlayerId));this.score=s.score;this.dispScore=s.dispScore;this.missMeter=s.missMeter;this.pressure=s.pressure||0;this.danger=s.danger;this.chain={...s.chain,players:new Set(s.chain.players||[])};this.now=s.now;this.state=s.state;
    this.falling=this.falling||[];this.fx=[];this.pops=this.pops||[];this.callouts=this.callouts||[];this.sfxLog=this.sfxLog||[];this.sparks=this.sparks||[];this.ripples=this.ripples||[];this.popups=this.popups||[];this.shake=this.shake||0;
    for(const event of s.events||[])if(event.id>(this._lastOnlineEvent||0)){this._lastOnlineEvent=event.id;this.applyOnlineEvent(event);}
    const p=this.players[this.activeP];if(p){const target=clamp(p.x+Math.sin(p.angle)*420-W/2,0,Math.max(0,this.WW-W));this.camX=this.camX===undefined?target:this.camX+(target-this.camX)*.35;}
    this.lobbyEl.style.display='none';this.reconnectEl.style.display='none';this.pauseEl.style.display=s.state==='paused'?'grid':'none';this.shadowRoot.querySelector('.onlineBar').style.display='flex';this.syncOnlineControls();
    if((s.state==='won'||s.state==='lost')&&oldState!==s.state)this.showEnd(s.state==='won');
  }
  battleBoardFromSnapshot(summary,data,old={}){
    const seat=summary.seat,rawPlayer=(data?.players||[])[0]||data?.player||{},wasPlayer=old.player?.id===summary.id?old.player:null;
    const player={...rawPlayer,i:0,id:summary.id,name:summary.name,meta:META[seat],bot:false,held:wasPlayer?wasPlayer.held:{},
      serverAngle:rawPlayer.angle,angle:wasPlayer?wasPlayer.angle:rawPlayer.angle??0,aimVel:wasPlayer?wasPlayer.aimVel:0,aimTarget:wasPlayer?wasPlayer.aimTarget:null,
      stats:summary.stats||rawPlayer.stats||old.player?.stats||{}};
    const rawGrid=data&&Array.isArray(data.grid)?data.grid:(old.grid?[...old.grid.values()]:[]);
    return {i:seat,id:summary.id,name:summary.name,meta:META[seat],connected:summary.connected,alive:summary.alive,place:summary.place,
      grid:new Map(rawGrid.map(b=>[key(b.r,b.c),b])),parityFlip:data?.parityFlip??old.parityFlip??0,anchorRow:data?.anchorRow??old.anchorRow??0,
      gridTop:data?.gridTop??old.gridTop??GRIDTOP0,gridTopTarget:data?.gridTopTarget??old.gridTopTarget??GRIDTOP0,lowestY:data?.lowestY??old.lowestY??0,
      flights:data?.flights||old.flights||[],falling:old.falling||[],pops:old.pops||[],sparks:old.sparks||[],ripples:old.ripples||[],callouts:old.callouts||[],popups:old.popups||[],
      batch:[],resolveAt:0,shotCount:0,specialFlip:0,score:summary.score||0,dispScore:summary.dispScore??summary.score??0,missMeter:summary.missMeter||0,
      pressure:summary.pressure||0,perDrop:summary.perDrop||0,danger:summary.danger,
      attackFlash:old.attackFlash??-9,chargeFlash:old.chargeFlash??-9,attackPend:null,_dead:false,player,playersArr:[player]};
  }
  applyOnlineBattleSnapshot(s){
    if(s.tick===0){this._lastOnlineBattleEvent=0;this._lastBattleOverviewEvent={};this._battlePreviews=new Map();}
    const oldState=this.state,oldBattle=this.battle,oldById=new Map((oldBattle?.boards||[]).map(b=>[b.id,b]));
    this.settings={...this.settings,...s.settings,mode:'battle',field:'classic'};this.applyRoomControls();if(this.setViewH(this.settings.viewH??H0))this.relayout();this.now=s.now;this.state=s.state;this.WW=W;this.cols=COLS;this.camX=0;
    this._battlePreviews=this._battlePreviews||new Map();if(s.overview)for(const preview of s.overview)this._battlePreviews.set(preview.id,preview);
    const summaries=[...(s.boards||[])].sort((a,b)=>a.seat-b.seat),boards=summaries.map(summary=>{
      const data=summary.id===this.onlinePlayerId?s.self:this._battlePreviews.get(summary.id),old=oldById.get(summary.id)||{};
      const board=this.battleBoardFromSnapshot(summary,data,old),last=this._lastBattleOverviewEvent?.[summary.id]||0;
      for(const event of data?.events||[])if(event.id>last){if(event.kind==='garbage')board.attackFlash=this.now;if(event.kind==='attack_ready')board.chargeFlash=this.now;}
      return board;
    });
    this._lastBattleOverviewEvent=this._lastBattleOverviewEvent||{};for(const preview of s.overview||[])this._lastBattleOverviewEvent[preview.id]=preview.eventId||this._lastBattleOverviewEvent[preview.id]||0;
    const human=boards.find(b=>b.id===this.onlinePlayerId)||boards[0],byId=new Map(boards.map(b=>[b.id,b]));
    this.battle={boards,human,view:human?.i||0,phase:(s.state==='won'||s.state==='lost')?'over':'play',spectate:s.state==='spectating',zoom:oldBattle?.zoom||0,
      targeting:s.pendingTarget&&human?{by:human.i,amount:s.pendingTarget.amount,t:s.pendingTarget.remaining,max:6,hover:oldBattle?.targeting?.hover??-1}:null,
      order:(s.order||[]).map(id=>byId.get(id)?.i).filter(i=>i!==undefined),winner:byId.get(s.winnerId)?.i??-1};
    if(human&&s.self){this.bindBoard(human);for(const event of s.self.events||[])if(event.id>(this._lastOnlineBattleEvent||0)){this._lastOnlineBattleEvent=event.id;this.applyOnlineEvent(event);}this.unbindBoard(human);}
    this.lobbyEl.style.display='none';this.reconnectEl.style.display='none';this.pauseEl.style.display=s.state==='paused'?'grid':'none';this.shadowRoot.querySelector('.onlineBar').style.display='flex';this.syncOnlineControls();
    if((s.state==='won'||s.state==='lost')&&oldState!==s.state){this.showBattleEnd();const button=this.shadowRoot.querySelector('.again');button.textContent=this.isOnlineHost()?'Return to lobby':'Waiting for host';button.disabled=!this.isOnlineHost();}
  }
  applyOnlineEvent(e){const d=e.data||{};if(e.kind==='launch'){const p=this.players[d.player];if(p)p.recoilT=this.now;this.sfx('launch');}else if(e.kind==='swap'){const p=this.players[d.player];if(p){if(p.cur)p.cur.swapT=this.now;if(p.next)p.next.swapT=this.now;}this.sfx('swap');}else if(e.kind==='bounce')this.sfx('bounce');else if(e.kind==='attach'){this.ripples.push({x:this.cellX(d.r,d.c),y:this.cellY(d.r),t:this.now});this.sfx('attach');}else if(e.kind==='pop'){for(const b of d.bubbles||[])this.pops.push({x:this.cellX(b.r,b.c),y:this.cellY(b.r),kind:b.kind,special:b.special,t:this.now,parts:[]});this.sfx((d.bubbles||[]).length>=6?'bigpop':'pop');}else if(e.kind==='drop'){for(const b of d.bubbles||[])this.falling.push({x:this.cellX(b.r,b.c),y:this.cellY(b.r),vx:0,vy:100,kind:b.kind,special:b.special,spin:0,a:0});this.sfx('drop');}else if(e.kind==='warn'){this.callout('DANGER! CLEAR THE LINE!','#ff5b6b');this.sfx('warn');}else if(e.kind==='rescue'){this.callout('TEAM RESCUE! +500','#3ecf72');this.sfx('rescue');}else if(e.kind==='ceiling'){this.callout('CEILING DROPS!','#ff5b6b');this.sfx('ceiling');}else if(e.kind==='attack_ready'){this.callout('BIG CLEAR! PICK A TARGET!','#ff8a3c');this.sfx('attackReady');}else if(e.kind==='attack_sent'){this.sfx('target');}else if(e.kind==='garbage'){const from=this.battle?.boards.find(b=>b.id===d.fromId);this.callout((from?.name||'A RIVAL')+' DUMPED '+d.amount+'!','#ff5b6b');this.sfx('junk');}else if(e.kind==='field_refilled'){this.callout('FIELD CLEAR! +1000','#3ecf72');}else if(e.kind==='level_cleared'){this.callout(d.final?'FINAL LEVEL CLEARED!':'LEVEL CLEARED! +'+(d.bonus||0),'#3ecf72');this.sfx('win');}else if(e.kind==='eliminated')this.sfx('lose');else if(e.kind==='win')this.sfx('win');else if(e.kind==='lose')this.sfx('lose');}
  setOnlineHeld(dir,value){this._onlineHeld=this._onlineHeld||{l:false,r:false};if(this._onlineHeld[dir]===value)return;this._onlineHeld[dir]=value;this._onlineAim=null;this._onlineAimWant=null;this.sendOnlineInput();}
  /* Point-to-aim ships an absolute angle rather than a direction, so it is a stream rather
     than two edges. The finger writes the wanted angle here and flushOnlineAim sends it at
     the server's own 20 Hz snapshot cadence; local prediction covers the gap between sends.
     Finger-up sends null, which puts the launcher back on the held-direction stream. */
  setOnlineAim(angle){this._onlineAimWant=angle;this.flushOnlineAim();}
  flushOnlineAim(){
    const want=this._onlineAimWant;if(want===undefined)return;
    const cur=this._onlineAim??null;
    if(want===null?cur===null:cur!==null&&Math.abs(want-cur)<0.005)return;
    const now=performance.now();if(now-(this._onlineAimAt||0)<50)return;
    this._onlineAim=want;this._onlineAimAt=now;this.sendOnlineInput();
  }
  sendOnlineInput(){this.sendOnline('input',{seq:++this.onlineSeq,held:this._onlineHeld||{l:false,r:false},aim:this._onlineAim??null});}
  syncOnlineControls(){if(!this.online)return;const host=this.isOnlineHost(),sh=this.shadowRoot;sh.querySelector('.onlinePause').style.display=host?'block':'none';sh.querySelector('.onlineRestart').style.display=host?'block':'none';sh.querySelector('.onlinePause').textContent=this.state==='paused'?'Resume':'Pause';sh.querySelector('.pause .resume').style.display=host?'block':'none';sh.querySelector('.pause .sub').textContent=host?'Press the button to resume for everyone':'Waiting for the host to resume';sh.querySelector('.onlineRoomLabel').textContent='Room '+(this.onlineRoom?.code||'');}
  setNetworkState(text,bad=false){const el=this.shadowRoot.querySelector('.netState');el.textContent=text;el.classList.toggle('bad',bad);}
  leaveOnline(){this._leaving=true;this.sendOnline('leave');if(this.ws)this.ws.close();this.clearOnlineSession();this.returnHome();setTimeout(()=>this._leaving=false,0);}
  clearOnlineSession(){try{localStorage.removeItem('bt_online_session');}catch(_){}this._onlineToken=null;this._onlineCode=null;}
  /* The host owns the control feel for the room, so a snapshot's tint and FIRE size have to
     reach the CSS variables the way a local slider would. The aim mode is not in room state
     and so is never touched here. */
  applyRoomControls(){this.applyTouchStyle();this._syncSettings&&this._syncSettings();}
  /* Snapshots merge the room's settings into ours, so leaving has to hand the device
     preferences back to their owner: otherwise the host's controls silently become yours for
     every local game that follows, overriding what you saved. The shipped defaults come
     first, so a room value is dropped even for a player who never saved a preference. */
  restoreLocalPrefs(){Object.assign(this.settings,{aimSpeed:2.4,padTint:0.025,fireScale:1},this.loadLocalPrefs());this.applyTouchStyle();this._syncSettings&&this._syncSettings();}
  returnHome(){clearTimeout(this._reconnectTimer);this.online=false;this.onlineRoom=null;this.onlinePlayerId=null;this.restoreLocalPrefs();this.state='home';this.hideOverlays();this.lobbyEl.style.display='none';this.reconnectEl.style.display='none';this.tutEl.style.display='none';this.homeEl.style.display='grid';this.shadowRoot.querySelector('.onlineBar').style.display='none';this.sideEl.style.display='';this.measure();this.resetGame();this.state='home';}
  escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  buildSettings() {
    const S = this.settings, el = this.sideEl;
    el.innerHTML = `
<h2>Bubble Together</h2>
<div style="color:#7593b5;font-size:13px">game settings</div>
<h3>Mode</h3><div class="seg modeSeg">
  <button data-m="clear">Co-op Clear</button><button data-m="endless">Endless</button><button data-m="battle">Battle</button></div>
<div class="battleNote" style="display:none;color:#9db8d4;font-size:12px;margin-top:4px">battle royale: private boards \u00b7 big clears let you dump junk on a rival \u00b7 you vs. bots locally, humans online</div>
<div class="fieldWrap"><h3>Field</h3><div class="seg fldSeg">
  <button data-f="classic">Classic</button><button data-f="wide">Wide 4\u00d7</button></div>
<div style="color:#9db8d4;font-size:12px;margin-top:2px">wide: the camera pans as you aim</div></div>
<h3>Level</h3>
<div class="seg lvlSeg">${LEVELS.map((L, i) => `<button data-lv="${i}">${i + 1}. ${L.name}</button>`).join('')}<button data-lv="custom">Custom</button></div>
<details><summary>Custom level editor</summary>
  <div style="color:#9db8d4;font-size:12px;margin:6px 0">One row per line \u00b7 R G Y B, dot = empty \u00b7 rows alternate 11 / 10 wide \u00b7 floaters are removed</div>
  <textarea class="lvlTxt" rows="7" spellcheck="false"></textarea>
  <button class="btn ghost playCustom">Save &amp; play custom</button>
</details>
<h3>Players</h3>
<div class="seg cntSeg"><button data-n="2">2</button><button data-n="3">3</button><button data-n="4">4</button><button data-n="5">5</button><button data-n="6">6</button><button data-n="7">7</button><button data-n="8">8</button></div>
<div class="pList"></div>
<div class="row"><span>Bot difficulty</span><div class="seg botSeg">
  <button data-b="relaxed">Relaxed</button><button data-b="normal">Normal</button><button data-b="skilled">Skilled</button></div></div>
<h3>Tuning</h3>
<div class="row"><span>Reload</span><input type="range" class="rl" min="0.8" max="2.2" step="0.05"><span class="val rlv"></span></div>
<div class="row"><span>Miss limit</span><input type="range" class="mm" min="4" max="20" step="1"><span class="val mmv"></span></div>
<div class="row"><span>Shot pressure</span><input type="range" class="sp" min="0" max="20" step="1"><span class="val spv"></span></div>
<div class="row"><span>Rescue timer</span><input type="range" class="rc" min="3" max="5" step="0.5"><span class="val rcv"></span></div>
<div class="row"><span>Aim assist</span><input type="range" class="aa" min="0" max="1" step="0.05"><span class="val aav"></span></div>
<div class="row"><span>Aim speed</span><input type="range" class="as" min="0.6" max="6" step="0.1"><span class="val asv"></span></div>
<div class="row"><span>Touch tint</span><input type="range" class="pt" min="0" max="0.3" step="0.005"><span class="val ptv"></span></div>
<div class="row"><span>FIRE size</span><input type="range" class="fs" min="0.6" max="2.2" step="0.05"><span class="val fsv"></span></div>
<div style="color:#9db8d4;font-size:12px;margin-top:-2px">touch tint: how strongly the aim halves glow blue while held · in an online room the host sets aim speed, tint and FIRE size for everyone</div>
<div class="row"><span>Touch aiming</span><div class="seg amSeg">
  <button data-am="halves">Left / right</button><button data-am="point">Where I press</button></div></div>
<div style="color:#9db8d4;font-size:12px;margin-top:-2px">where I press: drag anywhere on the board and the cannon swings to your finger · FIRE still shoots · touch screens only, and it stays yours in online rooms</div>
<div class="row"><span>Aim guide</span><div class="seg glSeg">
  <button data-g="1">Full path</button><button data-g="0.5">Short</button><button data-g="0.25">Tiny</button></div></div>
<div class="row tlRow"><span>Teammate lines</span><div class="seg tlSeg"><button data-v="1">Show</button><button data-v="0">Hide</button></div></div>
<div class="row"><span>Sound</span><div class="seg sndSeg"><button data-v="1">On</button><button data-v="0">Off</button></div></div>
<button class="btn ghost pauseBtn">Pause (P)</button>
<button class="btn ghost resetBtn">Reset stage</button>
<button class="btn ghost howBtn">How to play</button>
<h3>Controls</h3>
<ul class="ctrlList">${META.slice(0,4).map((m, i) => `<li${i ? '' : ' class="ctrlP1"'}><b style="color:${m.accent}">${m.name}</b> \u2014 <span class="ctrlText">${m.ctrl}</span></li>`).join('')}</ul>`;
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
      el.querySelector('.sp').value = S.pressureShots;
      el.querySelector('.spv').textContent = S.pressureShots ? S.pressureShots + ' shots' : 'off';
      el.querySelector('.rc').value = S.rescueDur; el.querySelector('.rcv').textContent = S.rescueDur.toFixed(1) + 's';
      el.querySelector('.aa').value = S.assist; el.querySelector('.aav').textContent = Math.round(S.assist * 100) + '%';
      el.querySelector('.as').value = S.aimSpeed; el.querySelector('.asv').textContent = S.aimSpeed.toFixed(1) + '×';
      el.querySelector('.pt').value = S.padTint;
      el.querySelector('.ptv').textContent = S.padTint ? (S.padTint * 100).toFixed(1) + '%' : 'off';
      el.querySelector('.fs').value = S.fireScale; el.querySelector('.fsv').textContent = S.fireScale.toFixed(2) + '×';
      el.querySelectorAll('.amSeg button').forEach(b => b.classList.toggle('on', b.dataset.am === S.aimMode));
      const hint = AIM_HINT[S.aimMode] || AIM_HINT.halves;
      el.querySelector('.ctrlP1 .ctrlText').textContent = hint.ctrl;
      const tutAim = this.shadowRoot.querySelector('.tutAim'); if (tutAim) tutAim.textContent = hint.tut;
      const isB = S.mode === 'battle';
      el.querySelector('.fieldWrap').style.display = isB ? 'none' : '';
      el.querySelector('.tlRow').style.display = isB ? 'none' : '';
      el.querySelector('.battleNote').style.display = isB ? '' : 'none';
      el.querySelectorAll('.cntSeg button').forEach(b => { b.style.display = (+b.dataset.n > 4 && !isB) ? 'none' : ''; });
      const pl = el.querySelector('.pList');
      pl.style.display = isB ? 'none' : '';
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
    this._syncSettings = syncAll; // so the level chain can re-mark the level picker
    segWire('.modeSeg', null, b => { S.mode = b.dataset.m;
      if (S.mode === 'battle') { if (S.players < 4) S.players = 8; else if (S.players === 4) S.players = 8; }
      else if (S.players > 4) S.players = 4;
      this.resetGame(); });
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
    segWire('.cntSeg', null, b => { S.players = +b.dataset.n; if (S.mode === 'battle') { this.resetGame(); } else { S.missMax = 4 + 2 * S.players; this.spawnPlayers(); } });
    segWire('.botSeg', null, b => { S.botSkill = b.dataset.b; });
    segWire('.tlSeg', null, b => { S.mateLines = +b.dataset.v === 1; });
    segWire('.glSeg', null, b => { S.guide = +b.dataset.g; });
    segWire('.sndSeg', null, b => { S.sound = +b.dataset.v === 1; if (S.sound) this.ensureAudio(); });
    segWire('.amSeg', null, b => { S.aimMode = b.dataset.am; this.applyTouchStyle(); this.saveLocalPrefs(); });
    const slider = (cls, fmt, set) => { const s = el.querySelector(cls);
      s.oninput = () => { set(parseFloat(s.value)); syncAll(); }; };
    slider('.rl', 0, v => S.reload = v);
    slider('.mm', 0, v => S.missMax = v);
    slider('.sp', 0, v => S.pressureShots = v);
    slider('.rc', 0, v => S.rescueDur = v);
    slider('.aa', 0, v => S.assist = v);
    slider('.as', 0, v => { S.aimSpeed = v; this.saveLocalPrefs(); });
    slider('.pt', 0, v => { S.padTint = v; this.applyTouchStyle(); this.saveLocalPrefs(); });
    slider('.fs', 0, v => { S.fireScale = v; this.applyTouchStyle(); this.saveLocalPrefs(); });
    el.querySelector('.pauseBtn').onclick = () => this.togglePause();
    el.querySelector('.resetBtn').onclick = () => { this.state = 'play'; this.resetGame(); };
    el.querySelector('.howBtn').onclick = () => this.showTutorial();
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
