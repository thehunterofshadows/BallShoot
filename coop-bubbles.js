/* Bubble Together — cooperative and competitive multiplayer bubble shooter.
   Architecture: local authoritative state is updated separately from rendering;
   online rooms consume server-authoritative snapshots. Each player remains an
   independent pointer, key-pair, bot, or WebSocket input stream. */
(() => {
if (customElements.get('coop-bubbles')) return;
// Loaded by the document before this component; local play and the server share rules.
const CoopObjects = globalThis.CoopObjects;
const CoopCampaigns = globalThis.CoopCampaigns;
const { COOP2_LEVELS, CAMPAIGNS } = CoopCampaigns;

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
const PAL  = { R:'#ff5b6b', Y:'#ffc233', G:'#3ecf72', B:'#3f9dff', P:'#a95cf2', O:'#ff8a2a' };
const PALD = { R:'#d13a4c', Y:'#d69a12', G:'#1fa557', B:'#2273cc', P:'#7a35c4', O:'#d2600c' };
// Random rows (endless, battle junk) stay four-colour; authored levels use LEVEL_KINDS.
const KINDS = ['R','Y','G','B'];
const BUBBLE_SPRITE_URLS = {
  R:'assets/bubbles/red.webp', Y:'assets/bubbles/yellow.webp',
  G:'assets/bubbles/green.webp', B:'assets/bubbles/blue.webp',
  P:'assets/bubbles/purple.webp', O:'assets/bubbles/orange.webp',
  rainbow:'assets/bubbles/rainbow.webp', bomb:'assets/bubbles/bomb.webp',
};
const BUBBLE_SPRITES = {};
if (typeof Image !== 'undefined') {
  for (const [id, src] of Object.entries(BUBBLE_SPRITE_URLS)) {
    const img = new Image(); img.decoding = 'async'; img.src = src; BUBBLE_SPRITES[id] = img;
  }
}
const LAUNCHER_ASSET_VERSION = encodeURIComponent(BUILD_STAMP);
const LAUNCHER_SPRITE_URLS = {
  base:`assets/launcher/base.webp?v=${LAUNCHER_ASSET_VERSION}`,
  turret:`assets/launcher/turret.webp?v=${LAUNCHER_ASSET_VERSION}`,
  shadow:`assets/launcher/shadow.webp?v=${LAUNCHER_ASSET_VERSION}`,
  muzzle:`assets/launcher/muzzle.webp?v=${LAUNCHER_ASSET_VERSION}`,
};
const LAUNCHER_SPRITES = {};
if (typeof Image !== 'undefined') {
  for (const [id, src] of Object.entries(LAUNCHER_SPRITE_URLS)) {
    const img = new Image(); img.decoding = 'async'; img.src = src; LAUNCHER_SPRITES[id] = img;
  }
}
/* theme:begin — fantasy-arcade cabinet art. Presentation only: every piece is laid out
   around the existing field geometry and nothing here feeds the simulation. Each piece is
   optional; until (or unless) an image loads, render() keeps the procedural chamber, so a
   missing file never costs a playable, readable board. */
const THEME_ASSET_VERSION = encodeURIComponent(BUILD_STAMP);
const THEME_URLS = {
  background:`assets/theme/fantasy-night.webp?v=${THEME_ASSET_VERSION}`,
  glass:`assets/theme/playfield-glass.webp?v=${THEME_ASSET_VERSION}`,
  top:`assets/theme/frame-top.webp?v=${THEME_ASSET_VERSION}`,
  left:`assets/theme/frame-left.webp?v=${THEME_ASSET_VERSION}`,
  right:`assets/theme/frame-right.webp?v=${THEME_ASSET_VERSION}`,
  bottom:`assets/theme/frame-bottom.webp?v=${THEME_ASSET_VERSION}`,
  deck:`assets/theme/launcher-deck.webp?v=${THEME_ASSET_VERSION}`,
};
const THEME_SPRITES = {};
if (typeof Image !== 'undefined') {
  for (const [id, src] of Object.entries(THEME_URLS)) {
    const img = new Image(); img.decoding = 'async'; img.src = src; THEME_SPRITES[id] = img;
  }
}
const themeImg = id => { const img = THEME_SPRITES[id]; return img && img.complete && img.naturalWidth ? img : null; };
/* Source rectangles are measured from the authored art (px); placements are in world units.
   - glass: the panel's opaque box. Scaled to the field width; a tall field repeats `band`
     (a quiet stretch of starfield, mirrored so it joins seamlessly) instead of stretching.
   - rails: top cap / repeating tube section / bottom cap, so a 1080–1560 view gains whole
     tubes rather than taller ones. `bar` is the rail's centre column in the art, `at` where
     that column sits on screen.
   - top: the marquee is scaled so its sign fits between the HUD boxes and cropped at
     `floor`, just above GRIDTOP0, so it never reaches a cell.
   - bottom / deck: the tray is placed under the launchers; the deck's sockets (`sockets`,
     `socketY`) are scaled onto the two live launchers and it is only used when they fit. */
const THEME_ART = {
  glass: { sx:63, sy:90, sw:897, sh:1177, band:[545, 655] },
  rails: { scale:0.16, top:60,
    left:  { bar:236, at:6,   tile:[565, 1015] },
    right: { bar:513, at:634, tile:[585, 1065] } },
  top: { scale:0.42, y:-7, floor:104 },
  bottom: { scale:0.95, trayY:177, gap:6 },
  deck: { sockets:[314, 712], socketY:145, drop:8, minScale:0.7, maxScale:0.95 },
};
/* theme:end */
/* levels:begin — mirrored verbatim in server/game.js and coop-bubbles.js (a test holds them
   equal), so every room builds exactly the board a local game does.

   Rounds are drawn the way Puzzle Bobble draws them: small readable pictures with open
   space, big masses hung from thin stems so one good shot drops the lot, and pockets only a
   bank shot reaches. Difficulty climbs by colour count first — 3, then 4, 5 and 6 — and
   each round teaches one idea. Rows alternate 11/10 wide (even rows anchor to the ceiling),
   at most 12. `layouts.coop2` is the round redrawn for the 16/15 two-player board (see
   GRID_PROFILES): its own name, pace and rows, built around shared supports, centre
   anchors and cross-board angles rather than a doubled wall. Cells: R Y G B P O colours,
   # stone (never pops, only falls), * star (a shot landing beside it pops every bubble of
   the shot's colour), + rainbow (joins any colour's group), . empty. `drop` is the shots per ceiling drop at the default Shot pressure. */
const LEVEL_KINDS = ['R', 'Y', 'G', 'B', 'P', 'O'];
const LEVEL_SPECIALS = { '#': 'stone', '*': 'star', '+': 'rainbow' };
const levelCell = ch => LEVEL_KINDS.includes(ch) ? { kind: ch, special: null }
  : LEVEL_SPECIALS[ch] ? { kind: ch, special: LEVEL_SPECIALS[ch] } : null;
const levelColors = rows => new Set(rows.join('').split('').filter(ch => LEVEL_KINDS.includes(ch))).size;
/* Grid profiles: the width of the staggered field's rows. Even rows (anchored to the
   ceiling) hold `evenColumns`, odd rows `oddColumns`, and one profile is one continuous
   grid. `classic` is the 11/10 board every mode has always played. `coop2` is the 16/15
   board built for local two-player Co-op Clear: twice the useful width, the same bubbles.
   A round without its own coop2 layout keeps its classic rows centred on it, paced
   `fallbackDropScale` slower because two launchers share the wider field. */
const GRID_PROFILES = {
  classic: { evenColumns: 11, oddColumns: 10, staggered: true, fallbackDropScale: 1 },
  coop2:   { evenColumns: 16, oddColumns: 15, staggered: true, fallbackDropScale: 1.3 },
};
const rowsFit = (rows, profile) => rows.every((row, r) => row.length === (r % 2 ? profile.oddColumns : profile.evenColumns));
/* What a round plays with on a profile: its authored `layouts[profile]` when it has one,
   otherwise its classic rows shifted `off` whole columns (which keeps every neighbour). */
const levelLayout = (L, profile = 'classic') => {
  const v = L.layouts && L.layouts[profile];
  if (v) return { name: v.name || L.name, rows: v.rows, drop: v.drop, objects: v.objects, off: 0 };
  const P = GRID_PROFILES[profile] || GRID_PROFILES.classic, C = GRID_PROFILES.classic;
  return { name: L.name, rows: L.rows, objects: L.objects, drop: Math.round(L.drop * P.fallbackDropScale),
    off: Math.floor((P.evenColumns - C.evenColumns) / 2) };
};
/* The cells a resolving shot of `kind` clears through a star beside it, or null: the shot,
   the star(s) it touched and every plain bubble of that colour on the board. */
const starHit = (grid, around, b, kind) => {
  const stars = around.map(([r, c]) => grid.get(r + ',' + c)).filter(n => n && n.special === 'star');
  if (!stars.length || !LEVEL_KINDS.includes(kind)) return null;
  const out = new Set([b.r + ',' + b.c]);
  for (const s of stars) out.add(s.r + ',' + s.c);
  grid.forEach((g, k) => { if (g.kind === kind && !g.special) out.add(k); });
  return out;
};
const LEVELS = [
  // 1-10 · three colours · shapes, direct matches, the first stem cut
  { name: 'Hello Bubbles', drop: 10, layouts: { coop2: { name: 'Open Hands', drop: 16, rows: [
      'RRRR..YYYY..BBBB',
      'RRR...YYY...BBB',
      '.BB....RR....YY.',
    ] } }, rows: [
    'RRRYYYYYBBB',
    'RRRYYYYBBB',
    'RR..YYY..BB',
  ]},
  { name: 'Smile', drop: 10, layouts: { coop2: { name: 'Twin Towers', drop: 16, rows: [
      'YYYY........GGGG',
      'RRRR.......RRRR',
      'GGGGRRRRRRRRYYYY',
      '.GGG.......YYY.',
      '..YY........GG..',
    ] } }, rows: [
    'YYYYYYYYYYY',
    'YGGYYYYGGY',
    'YYYYYYYYYYY',
    'R........R',
    '.RRRRRRRRR.',
  ]},
  { name: 'Stripes', drop: 10, layouts: { coop2: { name: 'Center Cut', drop: 15, rows: [
      'YY....BBBB....RR',
      'Y......BB.....R',
      '.......YY.......',
      '....RRRYRRR....',
      '..RRRRYYYYRRRR..',
      '..YYYYBBBYYYY..',
      '....BBB..BBB....',
    ] } }, rows: [
    'RRGGBBBGGRR',
    'RGGBBBBGGR',
    'RRGGBBBGGRR',
    '.RGG..GGR.',
  ]},
  { name: 'Little Heart', drop: 10, layouts: { coop2: { name: 'Crossfire', drop: 15, rows: [
      'BBBBBB....GGGGGG',
      '.RRRR......YYYY',
      '..GG........BB..',
      '..YY........RR.',
    ] } }, rows: [
    'BRRRBBBRRRB',
    'RRYRRRRYRR',
    'BRRRRRRRRRB',
    '..RRRRRR..',
    '....RRR....',
  ]},
  { name: 'Arrow', drop: 10, layouts: { coop2: { name: 'The Bridge', drop: 14, rows: [
      'GG.....BB.....GG',
      'G......B......G',
      'RRRRRRRYRRRRRRRR',
      'YYY..BBBBB..YYY',
      '.BB....YY....BB.',
    ] } }, rows: [
    '...GGGGG...',
    '...GGGG...',
    '.YYYGGGYYY.',
    '..YYYYYY..',
    '....BBB....',
  ]},
  { name: 'Twin Pendants', drop: 10, layouts: { coop2: { name: 'Bank Exchange', drop: 14, rows: [
      'Y..GGGGBBGGGG..Y',
      'Y..RRRRBRRRR..Y',
      'B..RRYYBBYYRR..B',
      '...GGGBBBGGG...',
      '...YYY....YYY...',
      '..BBBB....BBBB.',
    ] } }, rows: [
    'YYBBYYYBBYY',
    '..B....B..',
    '.GGGG.GGGG.',
    'GGGG..GGGG',
    '.GGG...GGG.',
  ]},
  { name: 'Pyramid', drop: 10, layouts: { coop2: { name: 'Two Keys', drop: 13, rows: [
      'G..PP......BB..G',
      'G..P.......B..G',
      '...RRRRRRRRRR...',
      '...YYGGGGGGYY..',
      '....YYGGRGGYY...',
      '.....YYRRRYY...',
      '.......BP.......',
    ] } }, rows: [
    'RRRRRRRRRRR',
    '.YYYYYYYY.',
    '..GGGGGGG..',
    '...RRRR...',
    '....YYY....',
  ]},
  { name: 'Cherries', drop: 10, layouts: { coop2: { name: 'Domino Drop', drop: 13, rows: [
      'YYY....GG....BBB',
      'YY.....G.....BB',
      'YY.....P......BB',
      'Y...RRRPRRR...B',
      'Y..RRBBBBBBRR..B',
      '...BBBYYYYBBB..',
      '.....GG..GG.....',
    ] } }, rows: [
    'YYYGGGGGYYY',
    '...G..G...',
    '...G...G...',
    '..RR..RR..',
    '..RRR.RRR..',
  ]},
  { name: 'Bridge', drop: 10, layouts: { coop2: { name: 'Hanging Garden', drop: 12, rows: [
      '.GGG..YYYY..BBB.',
      '..R....YY....P.',
      '..RR....P....PP.',
      '.BBB...PPP...YY',
      '.BRB...RRRR.....',
      '..B....RGGR....',
      '........RR......',
      '........G......',
    ] } }, rows: [
    'BBB.....BBB',
    'BB......BB',
    'BYYYYYYYYYB',
    '.R.R..R.R.',
  ]},
  { name: 'The Kite', drop: 10, layouts: { coop2: { name: 'Crossed Supports', drop: 12, rows: [
      'OOO..........BBB',
      '.OO.........BB.',
      '..RR........YY..',
      '...RR......YY..',
      '....RR....YY....',
      '.....RR..YY....',
      '......RGGY......',
      '.....PGGGGP....',
      '....PPP..PPP....',
    ] } }, rows: [
    '....YYY....',
    '....YY....',
    '....RRR....',
    '...RGGR...',
    '...RGGGR...',
  ]},
  // 11-22 · four colours · pendants on one-bubble stems, bank-shot pockets
  { name: 'Four Corners', drop: 9, layouts: { coop2: { name: 'Shared Rescue', drop: 11, rows: [
      '.....GGGGGG.....',
      '.....OOOOOO....',
      '......BBBBB.....',
      '......YYYY.....',
      '....RRRPPRRR....',
      '..YYRRPPRRYY...',
      '.GGGGYYOOYYGGGG.',
      'BBBBB.GGG.BBBBB',
      '.RR..........RR.',
    ] } }, rows: [
    'RRRR...BBBB',
    'RRRY..YBBB',
    'RRYY...YYBB',
    'GGG....GGG',
    'GGG.....GGG',
  ]},
  { name: 'Pendulum', drop: 9, layouts: { coop2: { name: 'Grand Canopy', drop: 11, rows: [
      '..PP...BB...OO..',
      '..P....B....O..',
      '.RRYYGGRRGGYYRR.',
      'RRYYGGBRBGGYYRR',
      'Y.RR..YYYY..RR.Y',
      'O.GG..PPPP..GGO',
      '...BB..OOOO..BB.',
    ] } }, rows: [
    'YYYYBBBYYYY',
    '....BB....',
    '.....B.....',
    '....RR....',
    '...RGGGR...',
    '...RGGR...',
    '....RRR....',
  ]},
  { name: 'Butterfly', drop: 9, rows: [
    'RR...G...RR',
    'RRY.GG.YRR',
    'RYYY.G.YYYR',
    'BYY.GG.YYB',
    'BB...G...BB',
    '.B..GG..B.',
  ]},
  { name: 'Bank Shot', drop: 9, rows: [
    'RRRRRRRRRRR',
    'B.GGGGGG.B',
    'B.GGGGGGG.B',
    '..YYYYYY..',
    '...YYYYY...',
  ]},
  { name: 'Lantern', drop: 9, rows: [
    '...BBBBB...',
    '....BB....',
    '...RRRRR...',
    '..RYYYYR..',
    '..RYYGYYR..',
    '..RYYYYR..',
    '...RRRRR...',
  ]},
  { name: 'Zigzag', drop: 9, rows: [
    'GGGGGGGGGGG',
    'YY..YY..YY',
    '.BB.BBB.BB.',
    'RR..RR..RR',
    '.YY.YYY.YY.',
  ]},
  { name: 'Crown', drop: 9, rows: [
    'YYYYYYYYYYY',
    'YRRYGGYRRY',
    'YY.YYYYY.YY',
    'Y..BYYB..Y',
    'Y...YYY...Y',
  ]},
  { name: 'Wind Chimes', drop: 9, rows: [
    'BBBBBBBBBBB',
    'R.Y.GG.Y.R',
    'R.Y..G..Y.R',
    'R.Y.GG.Y.R',
    'R.Y..G..Y.R',
    'B.B.BB.B.B',
  ]},
  { name: 'Checkerboard', drop: 9, rows: [
    'RRBBRRRBBRR',
    'YYGGYYGGYY',
    'BBRRBBBRRBB',
    'GGYYGGYYGG',
    '..RR.B.RR..',
  ]},
  { name: 'Side Pocket', drop: 9, rows: [
    'BBBBBBBBBBB',
    'Y.RRRRRR.Y',
    'Y..RRRRR..Y',
    'Y..GGGG..Y',
    'YY..GGG..YY',
    '.Y......Y.',
  ]},
  { name: 'Umbrella', drop: 9, rows: [
    '..RRRRRRR..',
    '.RRYRRYRR.',
    'RRYRRRRRYRR',
    'B...GG...B',
    '.....G.....',
    '....GG....',
    '....G......',
  ]},
  { name: 'Jellyfish', drop: 9, rows: [
    '...BBBBB...',
    '..BBYYBB..',
    '.BBYYYYYBB.',
    '.B.R..R.B.',
    '.G..R.R..G.',
    '.G.R..R.G.',
  ]},
  // 23-34 · five colours (+purple) · stones that only clear by falling
  { name: 'Stepping Stones', drop: 8, rows: [
    'RRRYYGYYRRR',
    'RR#YYYY#RR',
    'BBB#PPP#BBB',
    'BB#.PP.#BB',
    'P#.......#P',
  ]},
  { name: 'Castle Gate', drop: 8, rows: [
    'YYYYYYYYYYY',
    '#RRRPPRRR#',
    '#RR#PPP#RR#',
    '#GG#..#GG#',
    '#GG#...#GG#',
    '.BB....BB.',
  ]},
  { name: 'Rock Garden', drop: 8, rows: [
    'GGGGGGGGGGG',
    'G#GG##GG#G',
    '.PP.YYY.PP.',
    '.#P.YY.P#.',
    '..RR.B.RR..',
    '..#R..R#..',
  ]},
  { name: 'Anchor', drop: 8, rows: [
    'GGGBBBBBGGG',
    '....PP....',
    '.....#.....',
    '....##....',
    '..YYY#YYY..',
    '.RY....YR.',
    '.RR.....RR.',
  ]},
  { name: 'Keystone', drop: 8, rows: [
    'YYY.....YYY',
    'PPB....BPP',
    'PPB.....BPP',
    'GPB....BPG',
    '.GBR...RBG.',
    '..GR##RG..',
  ]},
  { name: 'Quarry', drop: 8, rows: [
    'BBBBBBBBBBB',
    'BYYYYYYYYB',
    'BY#######YB',
    'PP#RRRR#PP',
    '.P#RGGGR#P.',
    '..#RGGR#..',
    '...#RRR#...',
  ]},
  { name: 'Stone Bell', drop: 8, rows: [
    '....RRR....',
    '....PP....',
    '...#YYY#...',
    '..#YYYY#..',
    '..#GGGGG#..',
    '.#GBBBBG#.',
    '.##.....##.',
  ]},
  { name: 'Totem', drop: 8, rows: [
    '..RRRRRRR..',
    '..#GGGG#..',
    '..#PBBBP#..',
    '...YYYY...',
    '..#YRRRY#..',
    '..#GGGG#..',
    '...PPPPP...',
    '....##....',
  ]},
  { name: 'Hourglass', drop: 8, rows: [
    'PPPPPPPPPPP',
    '.YYYYYYYY.',
    '..YYYYYYY..',
    '...#RR#...',
    '....#G#....',
    '...BGGB...',
    '..BBGGGBB..',
    '.BBBBBBBB.',
  ]},
  { name: 'Boulder Drop', drop: 8, rows: [
    'YYYYGGGYYYY',
    'B...GG...B',
    'B...RRR...B',
    'P..####..P',
    'P..#####..P',
    '...####...',
  ]},
  { name: 'Fortress', drop: 8, rows: [
    'RRRRRRRRRRR',
    '#GGGGGGGG#',
    '#G#BBBBB#G#',
    '#G#YYYY#G#',
    '#GG#PPP#GG#',
    '#GG#..#GG#',
    '.#G#...#G#.',
    '..#....#..',
  ]},
  { name: 'Mountain Pass', drop: 8, rows: [
    'YYYYY.YYYYY',
    '#PPP..PPP#',
    '##PP...PP##',
    '###B..B###',
    '###RB.BR###',
    '##RG..GR##',
    '#.RG...GR.#',
  ]},
  // 35-46 · six colours (+orange) · stars and grid rainbows, bigger cuts
  { name: 'Shooting Star', drop: 7, rows: [
    'OOOYYYYYOOO',
    '...Y**Y...',
    '..RRRYRRR..',
    '..GGBBGG..',
    '..PPGBGPP..',
    '...BPPB...',
  ]},
  { name: 'Prism', drop: 7, rows: [
    '..RRRRRRR..',
    '..OOOOOO..',
    '...YY+YY...',
    '...G++G...',
    '....B+B....',
    '....PP....',
  ]},
  { name: 'Rainbow Road', drop: 7, rows: [
    'RRRRRRRRRRR',
    'OOOOOOOOOO',
    'YYYY+++YYYY',
    'GGG+..+GGG',
    'BB+.....+BB',
    'P+......+P',
  ]},
  { name: 'Starfish', drop: 7, rows: [
    'GBP.OOO.PBG',
    '....OO....',
    '...OO*OO...',
    'OOOO**OOOO',
    '...YO*OY...',
    '..YY..YY..',
    '.YR.....RY.',
  ]},
  { name: 'Constellation', drop: 7, rows: [
    'BBBBBBBBBBB',
    'B*......*B',
    '.PP.....PP.',
    '..PYYYYP..',
    '..G.O*O.G..',
    '.GG.RR.GG.',
    '....R*R....',
  ]},
  { name: 'Fireworks', drop: 7, rows: [
    '..YYY.YYY..',
    '...O..O...',
    '..R*R.R*R..',
    'RRBR..RBRR',
    '.G.P...P.G.',
    'G..P..P..G',
  ]},
  { name: 'Kaleidoscope', drop: 7, rows: [
    'RYGBPOPBGYR',
    'OPB+GG+BPO',
    'YGBP*O*PBGY',
    '.RYG++GYR.',
    '..OBPRPBO..',
    '...G++G...',
    '....RYR....',
  ]},
  { name: 'Comet', drop: 7, rows: [
    'OOOOYYY....',
    'OOYYRR....',
    '.YYRR*BB...',
    '...R*BBGG.',
    '.....BGGPP.',
    '......GPP.',
    '........P..',
  ]},
  { name: 'Aurora', drop: 7, rows: [
    'GGGGGGGGGGG',
    'BGGBBBBGGB',
    'PBBPPPPPBBP',
    'OPPO++OPPO',
    '.OO.YYY.OO.',
    '..R.YY.R..',
    '..R.*.*.R..',
  ]},
  { name: 'Carousel', drop: 7, rows: [
    '....RRR....',
    '...YYYY...',
    '..OOOOOOO..',
    '.PPPPPPPP.',
    'BB.G.*.G.BB',
    'B..G..G..B',
    'B..+...+..B',
    '..GG..GG..',
  ]},
  { name: 'Starlight Chandelier', drop: 7, rows: [
    'YYYYYYYYYYY',
    '...YOOY...',
    '....O*O....',
    'RRRRBBRRRR',
    'P.G.BBB.G.P',
    'P.G.**.G.P',
    'PP.GG.GG.PP',
    '.P......P.',
  ]},
  { name: 'Supernova', drop: 7, layouts: { coop2: { name: 'Supernova', drop: 10, rows: [
    'RRROO..YY..OORRR',
    'RYYOO..BB..OOYY',
    'GYY+*..GG..*+YYG',
    'GBB+..PP...+BBG',
    'PGBB+..OO..+BBGP',
    '.PG...RRR...BGP',
    '..PGG..YY..GGP..',
  ] } }, rows: [
    'RRROO.OORRR',
    'RYY.OO.YYR',
    'GYY+**.+YYG',
    'G.B+**+B.G',
    'PGBB+..+BGP',
    '.PG.BB.GP.',
    '..PGG.GGP..',
    '...P...P..',
  ]},
  // 47-48 · finale ramp · six colours, but still the tier-4 ceiling pace and useful openings
  { name: 'The Vault', drop: 7, layouts: { coop2: { name: 'The Vault', drop: 9, rows: [
    'GGBYRO..OO..ORYG',
    'BRRBY..GG..YBRR',
    'RGG*R..YY..R*GGB',
    'BYR...PP...YRPB',
    'RGBO+..BB..+OGBR',
    'BYR...GG...RGPY',
    'RG#Y........Y#GB',
    'BYR.........GBY',
  ] } }, rows: [ // open weave — deliberate matches without the old solid-wall grind
    'GGBYROOYYGB',
    'BRR.BY..BY',
    'RGG*R..YOGB',
    'BYR..Y..BY',
    'RGB.O+GB.RG',
    'BYR...R.PY',
    'RG#Y...Y#GB',
    'BY.....GBY',
    'RGB.....RGB',
  ]},
  { name: 'Chandeliers', drop: 7, layouts: { coop2: { name: 'Chandeliers', drop: 9, objects: [
    { id:'leftShield', type:'shield', cells:[[8,0]] },
    { id:'rightShield', type:'shield', cells:[[8,15]] },
  ], rows: [
    'YYRBOY....YOBRYY',
    'RGGPR.....RPGGR',
    'GYYBG*....*GBYYG',
    'RBOBR.....RBOBR',
    'GYRBBY....YBBRYG',
    'RBGPB.....BPGYR',
    'GYR+........+RYG',
    'OO...........OO',
    'OO...........OOO',
  ] } }, objects: [
    { id:'leftShield', type:'shield', cells:[[8,0]] },
    { id:'rightShield', type:'shield', cells:[[8,9]] },
  ], rows: [ // shields are the puzzle; open lanes keep density from being the punishment
    'YYRBOYRBBYR',
    'RGG.RBGYRB',
    'GYYBG*RBGYR',
    'RBO..BGPRB',
    'GYRBBYRBGYR',
    'RB..PBGYOB',
    'GYR+...+GYR',
    'O........O',
    'OO.......OO',
  ]},
  // 49-52 · final tier · faster ceiling arrives only after the player has learned the finale shapes
  { name: 'The Canyon', drop: 6, layouts: { coop2: { name: 'The Canyon', drop: 8, objects: [
    { id:'westLock', type:'syncLock', cells:[[8,0]], pair:'eastLock', barrier:[[6,6],[6,9]] },
    { id:'eastLock', type:'syncLock', cells:[[8,15]], pair:'westLock', barrier:[[6,6],[6,9]] },
  ], rows: [
    'RRYGBO....OBGYRR',
    'YBBPY.....YPBBY',
    'BRRGBR....RBGRRB',
    'YGBYP.....PYBGY',
    'BRYGGR....RGGYRB',
    'Y#BR.YYYY..RB#Y',
    'BROG..RRRR..GORB',
    'YGB#.......#BGY',
    'PO............OP',
  ] } }, objects: [
    { id:'westLock', type:'syncLock', cells:[[10,0]], pair:'eastLock', barrier:[[7,3],[7,7]] },
    { id:'eastLock', type:'syncLock', cells:[[10,9]], pair:'westLock', barrier:[[7,3],[7,7]] },
  ], rows: [ // coordinated cuts, but with breathing room around the towers
    'RRYGBOY.GRY',
    'YBB.YGBRYG',
    'BRR.BR.O.RY',
    'YG..PGBRYG',
    'BRYG..YG.RY',
    'Y#BR...R#G',
    'BROG....PRY',
    'YGB#...#YG',
    'BRY....GBRY',
    'YGB.....YG',
    'PO.......OP',
  ]},
  { name: 'Hive Bridge', drop: 6, layouts: { coop2: { name: 'Hive Bridge', drop: 8, objects: [
    { id:'westArmor', type:'teamArmor', cells:[[8,0]] },
    { id:'eastArmor', type:'teamArmor', cells:[[8,15]] },
    { id:'pressure', type:'corruption', cells:[[6,4]], every:5, maxSpread:3 },
  ], rows: [
    'YBPRY......YRPBY',
    'GOYBG.....GBYOG',
    'YBGRY......YRBGY',
    'GPYB........BYG',
    'YBGRR......RRBGY',
    'GRO#.......#ORG',
    'YBGRY......YRBGY',
    'GRYB........BYR',
    'BBGPY......YPGGB',
  ] } }, objects: [
    { id:'westArmor', type:'teamArmor', cells:[[9,0]] },
    { id:'eastArmor', type:'teamArmor', cells:[[9,9]] },
    { id:'pressure', type:'corruption', cells:[[8,6]], every:5, maxSpread:3 },
  ], rows: [ // corruption supplies the pressure, so it spreads more slowly and tops out sooner
    'YBPRY......',
    'GOYBGG....',
    'YBGRY.BROBG',
    'GPYB..YBGR',
    'YBGRR.GRYPG',
    'GRO#..YBOR',
    'YBGRY.RRYBG',
    'GRYB..#GGR',
    'BBG+..GRRBO',
    'GYYB..YBGR',
  ]},
  { name: 'Grand Cathedral', drop: 6, layouts: { coop2: { name: 'Grand Cathedral', drop: 8, rows: [
    'PPPPP......PPPPP',
    'P#OOO.....OOO#P',
    'P#O+YY....YY+O#P',
    '#OYYR.....RYYO#',
    '#OY*R......R*YO#',
    '#GYR.......RYG#',
    '#GG..........GG#',
    '#BG.........GB#',
  ] } }, rows: [
    'PPPPPPPPPPP',
    'P#OOO.OO#P',
    'P#O+YYY+O#P',
    '#OYY..YYO#',
    '#OY*RRR*YO#',
    '#GYRBBRYG#',
    '#GG.BBB.GG#',
    '#BG....GB#',
    '.BG.....GB.',
    '..B....BB.',
  ]},
  { name: 'Bubble Together', drop: 6, layouts: { coop2: { name: 'Bubble Together', drop: 8, rows: [
    'PRRROP....OPBBBP',
    'RRRRY.....YBBBB',
    'RR*RR......BB*BB',
    'RRRRG......BBBB',
    '.RRR+......+BBB.',
    '..RRG.....GBB..',
    '...RY......YB...',
    '....R.....B....',
  ] } }, rows: [
    'PRRRPOPBBBP',
    'RRRRYYBBBB',
    'RR*RRYBB*BB',
    'RRRRGGBBBB',
    '.RRR+O+BBB.',
    '..RRGGBB..',
    '...RYOYB...',
    '....RB....',
    '....G#G....',
    '....GG....',
  ]},
];
/* levels:end */
const campaignLevels = id => id === 'coop2' ? COOP2_LEVELS : LEVELS;
const campaignLevel = (id, level) => campaignLevels(id)[Number(level) || 0] || campaignLevels(id)[0];
const campaignName = id => (CAMPAIGNS[id] || CAMPAIGNS.original).name;
/* P1's touch controls depend on the aim mode, so its hint is filled in from AIM_HINT rather
   than fixed here; the keyboard launchers never change. */
const AIM_HINT = {
  halves: { ctrl:'Touch the lower left / right to aim · FIRE to shoot',
    tut:'On mobile, hold the lower-left or lower-right half to aim, then tap FIRE above.' },
  point: { ctrl:'Drag anywhere on the board to aim · FIRE to shoot',
    tut:'On mobile, drag anywhere on the board and the cannon swings to your finger, then tap FIRE.' },
};
const META = [
  { name:'P1', accent:'#ff6fb1', trail:'solid', icon:'tri',    ctrl:AIM_HINT.halves.ctrl },
  { name:'P2', accent:'#a78bfa', trail:'dots',  icon:'square', ctrl:'A / D aim · W or Space fire · E pass · Q power' },
  { name:'P3', accent:'#35d3c8', trail:'rings', icon:'ring',   ctrl:'← / → aim · ↑ or Enter fire · / pass' },
  { name:'P4', accent:'#ffb054', trail:'spark', icon:'star',   ctrl:'J / L aim · K fire · I pass' },
  { name:'P5', accent:'#5fb7ff', trail:'solid', icon:'tri',    ctrl:'battle royale · bot or online' },
  { name:'P6', accent:'#9ad34d', trail:'dots',  icon:'square', ctrl:'battle royale · bot or online' },
  { name:'P7', accent:'#ff8a75', trail:'rings', icon:'ring',   ctrl:'battle royale · bot or online' },
  { name:'P8', accent:'#d4b45f', trail:'spark', icon:'star',   ctrl:'battle royale · bot or online' },
];
const SFX = { // sound-event hooks: name -> [freq, dur, type, slide]
  launch:[540,.07,'triangle',-120], bounce:[300,.05,'sine',60], attach:[220,.06,'sine',0],
  pop:[660,.12,'triangle',240], bigpop:[520,.22,'triangle',380], drop:[160,.35,'sawtooth',-90],
  chain:[880,.14,'triangle',220], warn:[240,.3,'square',-60], pressure:[170,.24,'sawtooth',-100], rescue:[720,.4,'triangle',300],
  win:[620,.6,'triangle',400], lose:[220,.7,'sawtooth',-140], swap:[430,.08,'sine',120], ceiling:[190,.3,'square',-50],
  attackReady:[760,.25,'triangle',320], junk:[210,.2,'square',-50], target:[560,.12,'sine',180],
  teamAssist:[590,.2,'sine',410], teamRescue:[480,.55,'triangle',520], teamDrop:[140,.45,'triangle',260], handoff:[990,.1,'sine',330],
  pass:[340,.3,'sine',560], passNo:[150,.04,'square',0],
  powerReady:[660,.35,'triangle',440], teamPower:[520,.8,'triangle',780], powerEnd:[420,.3,'sine',-180],
  dropTick:[980,.05,'square',-200], hurry:[700,.18,'square',-240],
};
/* team-rules:begin — mirrored verbatim in server/game.js and coop-bubbles.js (a test holds
   them equal), so local co-op and an online room qualify the same moments the same way.

   Co-op Clear makes teamwork the scoring, not a side effect. Every bubble
   remembers who placed it (`placedBy`) and when (`at`); every resolving shot knows when it
   was fired. A shot that clears or drops bubbles the teammate placed *before* it was fired
   is a setup assist: one flat bonus per resolving shot, however many of the teammate's
   bubbles went with it, so a giant cascade cannot run the score away. Starting-board
   bubbles (placedBy -1), your own bubbles, and a teammate's bubble that landed after you
   fired are never a setup. If an assisted shot is also the one that clears the danger
   line it is a team rescue, and a support cut that drops the teammate's bubbles in bulk is
   a team drop. Solo and Battle get no team events; every co-op roster of two or more qualifies. */
const TEAM = {
  tripleBonus: 200, // two distinct setup players plus the clearer
  assistBonus: 100,   // per resolving shot with at least one setup assist
  rescueBonus: 250,   // on top of the ordinary +500 rescue, when the rescue was set up
  dropBonus: 150, hugeDropBonus: 300,
  dropMin: 5, hugeDropMin: 10, // dropped bubbles, with teammate ownership among them
  chainSecs: 8,       // chain window; the chain lapses when it runs out
  feedback: true,     // enhanced co-op presentation (client only; scoring ignores it)
};
const teamPlay = (T, humans, shots, dropped, rescued) => {
  const out = { assists: [], rescue: null, drop: null, bonus: 0 };
  if (!humans || humans.length < 2) return out;
  const setup = (s, list) => [...new Set(list.filter(b => b.placedBy >= 0 && b.placedBy !== s.shooter &&
    humans.includes(b.placedBy) && b.at < s.at).map(b => b.placedBy))];
  for (const s of shots) {
    if (!humans.includes(s.shooter)) continue;
    const from = setup(s, s.bubbles.concat(dropped));
    if (from.length) { out.assists.push({ by: s.shooter, setup: from }); out.bonus += T.assistBonus + (from.length >= 2 ? T.tripleBonus : 0); }
  }
  if (rescued && out.assists.length) {
    out.rescue = { by: out.assists[0].by, setup: out.assists[0].setup };
    out.bonus += T.rescueBonus;
  }
  if (dropped.length >= T.dropMin) for (const s of shots) {
    if (!humans.includes(s.shooter)) continue;
    const from = setup(s, dropped);
    if (!from.length) continue;
    const huge = dropped.length >= T.hugeDropMin;
    out.drop = { by: s.shooter, setup: from, n: dropped.length, huge };
    out.bonus += huge ? T.hugeDropBonus : T.dropBonus;
    break;
  }
  return out;
};
/* team-rules:end */
/* bomb-reserve:begin — shared local/authority rules. Loaded bombs remain player-owned. */
const unusedBombs = p => (p.bombs || 0) + (p.bombLoaded ? 1 : 0);
const bombToggle = p => {
  if (!p || !p.cur || p.reload > 0 || p.connected === false) return false;
  if (p.bombLoaded) {
    p.cur = p.bombStored; p.bombStored = null; p.bombLoaded = false; p.bombs++;
  } else {
    if (!(p.bombs > 0)) return false;
    p.bombStored = p.cur; p.cur = { kind:p.cur.kind, special:'bomb' };
    p.bombs--; p.bombLoaded = true;
  }
  p.idle = 0;
  return true;
};
const bombRestoreAfterFire = p => {
  if (!p.bombLoaded) return false;
  p.cur = p.bombStored; p.bombStored = null; p.bombLoaded = false;
  return true;
};
/* bomb-reserve:end */

/* pass-rules:begin — mirrored verbatim in server/game.js and coop-bubbles.js (a test holds
   them equal), so a local pass and an online one are allowed at exactly the same moments.

   Co-op Clear lets a human PASS left or right: the chosen teammates' *current* bubbles swap
   in one step. A swap rather than a gift keeps the bubble economy untouched and leaves both
   launchers loaded; the `next` bubbles never move, and a bomb or rainbow travels with its
   bubble. One cooldown is shared by the roster, so whoever asks first spends it for everyone and
   a near-simultaneous second request is simply refused. A pass is not a shot: it touches
   no shot count, miss meter, pressure, score or chain. `passPair` answers whether a pass
   may happen and between whom — it returns the two launchers to swap, or null. */
const PASS = {
  cooldown: 5, // seconds of shared cooldown after a pass
};
const passPair = (humans, players, by, state, cd, direction = 1) => {
  if (state !== 'play' || cd > 0 || !humans || humans.length < 2 || !humans.includes(by)) return null;
  const live = humans.filter(i => players[i] && players[i].connected !== false);
  if (live.length < 2 || !live.includes(by)) return null;
  const at = live.indexOf(by), to = live[(at + (direction < 0 ? -1 : 1) + live.length) % live.length];
  const pair = [players[by], players[to]];
  if (pair.some(p => !p || p.connected === false || !p.cur || p.bombLoaded)) return null;
  return pair;
};
const passSwap = pair => { const [a, b] = pair, t = a.cur; a.cur = b.cur; b.cur = t; };
/* pass-rules:end */
/* power-rules:begin — mirrored verbatim in server/game.js and coop-bubbles.js (a test holds
   them equal), so local co-op and an online room charge and fire Team Power identically.

   Co-op Clear shares one Team Power meter. It fills from the resolved teamwork
   events the team rules already decide — one amount per event, never per bubble, so a big
   cascade cannot farm it — and a clear with no teammate involvement adds nothing. At full
   any human may cash it in for the equipped power; the meter empties on the spot, so a
   second request in the same instant finds nothing to spend. The meter does not fill while
   a power runs. Powers are plain definitions: a duration, which clocks they hold, and what
   they do to active teammates at the moment they start. A later power is one more entry in POWERS
   and a different `equipped`. `powerPair` answers whether a power may start and on whom —
   it returns the active launchers, or null. */
const TEAM_POWER = {
  max: 100,
  charge: { assist: 15, chain: 10, rescue: 25, drop: 10, hugeDrop: 20 }, // per resolved event
  chargeWhileActive: false,
  equipped: 'synergy',
};
const POWERS = {
  synergy: {
    name: 'SYNERGY BURST', secs: 8,
    holdPressure: true, // shots add no pressure or misses, and the ceiling stays put
    holdRescue: true,   // a running rescue countdown stops where it is
    start: pair => { for (const p of pair) { const slot = p.bombLoaded ? 'bombStored' : 'cur'; if (p[slot]) p[slot] = { kind:p[slot].kind, special:'rainbow' }; } },
  },
};
const powerCharge = (T, team, handoffs, active) => {
  const reasons = [];
  if (active && !T.chargeWhileActive) return { amount: 0, reasons };
  if (team) {
    for (let i = 0; i < team.assists.length; i++) reasons.push('assist');
    if (team.rescue) reasons.push('rescue');
    if (team.drop) reasons.push(team.drop.huge ? 'hugeDrop' : 'drop');
  }
  for (let i = 0; i < handoffs; i++) reasons.push('chain');
  return { amount: reasons.reduce((s, r) => s + T.charge[r], 0), reasons };
};
const powerPair = (T, humans, players, by, state, charge, active) => {
  if (state !== 'play' || active || charge < T.max || !humans || humans.length < 2 || !humans.includes(by)) return null;
  const me = players[by];
  if (!me || me.connected === false || me.bot) return null;
  return humans.map(i => players[i]).filter(p => p && p.connected !== false);
};
const powerHolds = (active, what) => !!(active && POWERS[active] && POWERS[active][what]);
/* power-rules:end */
/* pace-rules:begin — mirrored verbatim in server/game.js and coop-bubbles.js (a test holds
   them equal), so the ceiling, the clear clock and the idle timer run the same locally and
   online.

   Puzzle Bobble keeps a round moving three ways. The ceiling drops every `drop` shots — the
   level's own pace, scaled by the Shot pressure setting (0 turns it off) and one shot
   tighter for each of the level's colours the team has cleared off the board — and the pack
   shakes for the last `warnShots` shots before it goes. A fast clear pays a time bonus that
   slides from full at `timeFull` seconds to nothing at `timeZero`, a longer window than the
   arcade's minute because a co-op board is bigger. And a human who sits on a loaded
   launcher for the `hurry` setting's seconds is told HURRY UP! with `hurryWarn` left, then
   fires at whatever angle they hold. Firing, aiming or passing resets that clock. */
const PACE = {
  basePressure: 8, // the Shot pressure default, at which a level's `drop` is used as written
  warnShots: 2,
  timeBonus: 5000, timeFull: 15, timeZero: 120,
  hurryWarn: 5,
};
const dropPace = (drop, setting, colors, left, humans = 1) => {
  if (!setting) return 0;
  const base = drop ? Math.max(3, Math.round(drop * setting / PACE.basePressure)) : setting;
  const eased = Math.max(3, base - Math.max(0, colors - left));
  return Math.round(eased * (1 + 0.35 * Math.max(0, humans - 2)));
};
const clearTimeBonus = secs => Math.round(PACE.timeBonus *
  Math.max(0, Math.min(1, (PACE.timeZero - secs) / (PACE.timeZero - PACE.timeFull))));
// One human launcher's idle clock: 'warn' as it crosses into the last hurryWarn seconds,
// 'fire' once it runs out (and every tick after, until a shot actually leaves), else null.
const hurryTick = (p, dt, limit) => {
  if (!(limit > 0) || (p.held && (p.held.l || p.held.r || p.held.analog)) || p.aimTarget != null) { p.idle = 0; return null; }
  const was = p.idle || 0, warnAt = Math.max(0, limit - PACE.hurryWarn);
  p.idle = was + dt;
  if (p.idle >= limit) return 'fire';
  return was <= warnAt && p.idle > warnAt ? 'warn' : null;
};
/* pace-rules:end */
// "1. Hello Bubbles" … plus Custom: the one list both level pickers are built from.
const levelOptionsHTML = (campaign = 'original', custom = true) => campaignLevels(campaign).map((L, i) => `<option value="${i}">${i + 1}. ${L.name}</option>`).join('')
  + (custom && campaign !== 'coop2' ? '<option value="custom">Custom</option>' : '');
const PASS_FX = 0.45; // seconds a passed bubble spends in the air (presentation only)
const key = (r,c) => r + ',' + c;
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const rnd = (a,b) => a + Math.random() * (b - a);
/* Online snapshots replace authoritative positions, while these two helpers only carry
   transient visuals between packets. They deliberately refuse flights without velocity:
   an incomplete preview should freeze for one packet, never turn coordinates into NaN. */
const stepOnlineFlights = (flights, dt, left, right) => {
  for (const f of flights) {
    if (!Number.isFinite(f.vx) || !Number.isFinite(f.vy)) continue;
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.x < left) { f.x = 2 * left - f.x; f.vx = Math.abs(f.vx); }
    else if (f.x > right) { f.x = 2 * right - f.x; f.vx = -Math.abs(f.vx); }
  }
};
const stepOnlineFalling = (falling, dt, floor) => {
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i];
    f.vy = (f.vy || 0) + 1900 * dt; f.x += (f.vx || 0) * dt; f.y += f.vy * dt; f.a = (f.a || 0) + (f.spin || 0) * dt;
    if (f.y > floor) { f.y = floor; f.fade = (f.fade ?? 1) - 2.5 * dt; }
    if ((f.fade ?? 1) <= 0) falling.splice(i, 1);
  }
};
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
   the server's authority agree frame for frame.

   A held direction turns the launcher, and how fast depends on how long it has been held.
   One flat rate cannot serve both jobs the barrel has: at 2.4 rad/s the whole ±1.22 arc
   sweeps in a second, which is right for crossing the board and hopeless for picking a
   column, because the shortest tap a thumb can make is already fifteen degrees. So there is
   nothing to aim with — only overshoot and correct, which is what the launcher snapping
   between positions actually was. A fresh press turns at a quarter speed, and the rate eases
   up to the full setting once you have held it long enough to mean a sweep: taps are nudges,
   holds are sweeps, and the setting still scales both.

   This is a ramp in, not momentum. Release still stops the barrel on that frame — a coast
   past where you let go costs the one-degree correction the game is won on.

   With p.aimTarget set (point-to-aim) the barrel simply points where the finger is, the way
   a stylus port works: the aim line follows the touch rather than chasing it. */
const AIM_MAX = 1.22;
const AIM_FINE = 0.25;   // fraction of the aim speed a fresh press turns at
const AIM_SLOW_T = 0.16; // seconds held at the fine rate, so a tap stays a nudge
const AIM_RAMP_T = 0.40; // seconds to ease from the fine rate up to the full setting
/* 'halves' holds the lower-left or lower-right of the board to turn; 'point' aims the barrel
   at wherever the finger is. Both feed the same integrator below. */
const AIM_MODES = ['halves', 'point'];
const aimTick = (p, dt, aimSpeed) => {
  if (p.aimTarget != null) { p.angle = clamp(p.aimTarget, -AIM_MAX, AIM_MAX); p.heldT = 0; p.heldDir = 0; return; }
  // Analog magnitude is already deadzone-normalized at the input boundary.
  const analog = Number.isFinite(p.held?.analog) ? clamp(p.held.analog, -1, 1) : 0;
  if (analog) {
    p.heldT = 0; p.heldDir = 0;
    const base = Number(aimSpeed) > 0 ? Number(aimSpeed) : 2.4;
    if (dt > 0) p.angle = clamp(p.angle + analog * base * dt, -AIM_MAX, AIM_MAX);
    return;
  }
  const dir = (p.held && p.held.l ? -1 : 0) + (p.held && p.held.r ? 1 : 0);
  if (!(dt > 0) || !dir) { p.heldT = 0; p.heldDir = 0; return; }
  // Turning back is a new press: without this the correction at the end of a sweep would
  // start at full speed, which is the overshoot the ramp exists to stop.
  if (p.heldDir !== dir) { p.heldT = 0; p.heldDir = dir; }
  const base = Number(aimSpeed) > 0 ? Number(aimSpeed) : 2.4;
  const t = (p.heldT = p.heldT + dt);
  const k = t <= AIM_SLOW_T ? 0 : Math.min(1, (t - AIM_SLOW_T) / AIM_RAMP_T);
  const rate = base * (AIM_FINE + (1 - AIM_FINE) * k * k * (3 - 2 * k));
  p.angle = clamp(p.angle + dir * rate * dt, -AIM_MAX, AIM_MAX);
};
/* frame-pipeline:begin — how a presented frame is made. Animation reacts to gameplay;
   gameplay never waits for animation. Each requestAnimationFrame callback runs

     freshest input (pads polled now; key/pointer events already applied)
     → controls + simulation, in equal steps no longer than 1/simHz
     → visual effects → render the newest state → sync DOM HUD

   Presentation follows the browser's own rAF cadence (60, 120, 144 Hz…) with no cap, and the
   simulation only ever sees elapsed seconds, so gameplay speed is the same at any refresh
   rate. Shots already subdivide their flight by distance, so the step bound is not about
   collisions: it keeps curved motion (gravity, the aim ramp) landing in the same place at
   60 and 144 Hz. 120 Hz does that measurably better than 60 (see tests/frame-pipeline);
   240 is available through ?sim=240 for comparison, not assumed to lower latency. */
const FRAME = {
  simHz: 120,          // longest simulation step is 1/simHz
  simHzRange: [60, 480],
  maxFrameDt: 0.1,     // a longer gap (tab switch, long GC) is dropped, not fast-forwarded
  perfSample: 0.25,    // seconds between diagnostics overlay refreshes
};
// Equal steps covering one presented frame's elapsed time.
const simSteps = (dt, hz = FRAME.simHz) => {
  if (!(dt > 0)) return { n: 0, h: 0 };
  const d = Math.min(dt, FRAME.maxFrameDt), n = Math.max(1, Math.ceil(d * hz - 1e-6));
  return { n, h: d / n };
};
// The longest a cleared board holds before its card shows, so the final drop can land.
const OUTRO_MAX = 1.6;
const TRAIL_DT = 1 / 60; // a shot's trail keeps 16 samples this far apart at any frame rate
const DISPLAY_HZ = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360];
/* Presentation cadence from recent rAF intervals (ms). The median ignores the odd hitch, and
   the rate snaps to a known display refresh only when it is within 5% of one. */
const cadence = intervals => {
  const v = intervals.filter(x => x > 0 && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { fps: 0, hz: 0 };
  const mid = v.length >> 1, med = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, fps = 1000 / med;
  const near = DISPLAY_HZ.reduce((a, b) => Math.abs(b - fps) < Math.abs(a - fps) ? b : a);
  return { fps, hz: Math.abs(near - fps) / near <= 0.05 ? near : Math.round(fps) };
};
/* frame-pipeline:end */
/* Quantised to 20 virtual units so a drifting viewport — browser chrome sliding away,
   a fold animation mid-frame — cannot churn the world height on every resize tick. */
const geom = vh => {
  const H = clamp(Math.round(vh / 20) * 20, VIEWH_MIN, VIEWH_MAX), LAUNCH_Y = H - LAUNCH_GAP;
  return { H, LAUNCH_Y, DANGER_Y: LAUNCH_Y - DANGER_GAP };
};

/* tv-display:begin — TV / couch display. A presentation profile, never a game mode: the
   world, rules and input streams are identical, only how the page is composed changes.

   Everything is placed on one fixed 1920×1080 logical stage that is scaled whole into the
   viewport, so 1080p, 1440p and 4K show the same picture and anything that is not 16:9
   letterboxes or pillarboxes instead of stretching. Wide and tall screens bleed theme
   presentation into extra space rather than flat bars. Critical UI stays inside the safe
   area (`safeArea` of each edge) to survive TV overscan; the stage background and playfield
   may bleed past it. Forced TV enforces a minimum 960×540 viewport (scale 0.5) with a notice
   and pause below it. Auto mode includes hysteresis ([1.2, 3.6] aspect band once in TV) to
   prevent mid-match flip jitter. Every tuning value lives here — nothing downstream
   hard-codes a TV dimension. A mode gets its own composition by adding a spec to TV_LAYOUTS;
   the stage, safe area, typography, menu scale, fullscreen and controller focus come for free. */
const DISPLAY_MODES = ['auto', 'desktop', 'tv'];
const FIT_EDGES = ['top', 'right', 'bottom', 'left'];
const TV = {
  logicalW: 1920, logicalH: 1080,
  minViewport: { w: 960, h: 540 },
  safeArea: 0.05,        // default share of each edge kept clear of critical UI
  /* Screen Fit: the calibrated safe area, one share per edge. The player moves these in or
     out on the Screen Fit screen for their own TV's overscan; the default is safeArea all
     round. `fit` bounds and steps every edge — at the maximum inset every layout still fits. */
  screenFit: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  fit: { min: 0, max: 0.10, step: 0.005 },
  hudScale: 1.35,        // launcher labels and the touch pad, relative to desktop
  menuScale: 1.40,       // cards, drawer, corner buttons, relative to desktop
  /* Couch legibility. Type is designed for 8-12 ft, not multiplied up from the desk: every
     critical HUD string has its own logical-px size here (at 1080p, so 4K doubles it), and
     none may drop below minHudFontPx; menus are held to minMenuFontPx after menuScale. */
  minHudFontPx: 28, minMenuFontPx: 30,
  hudType: { label: 28, line: 30, big: 76, roundBig: 60, chain: 32, name: 44, nameSmall: 34, tag: 28,
    status: 32, info: 28, prompt: 30, toast: 34 },
  menuType: { title: 52, body: 30, button: 32, control: 30, small: 30, code: 64 },
  controllerNavigation: true, // d-pad / stick focus, default selection, A confirms, B backs out
  playfieldScale: 1.15,  // playfield height as a multiple of the safe height (capped at the stage)
  hideSecondaryHud: true,
  preferFullscreen: true,
  gap: 40,               // logical px between the playfield and the columns framing it
  chrome: 84,            // logical px square for the fullscreen / settings buttons
  promptH: 76,           // logical px kept free above the safe bottom for the controller legend
  headH: 212, rowGap: 24, powerH: 104, padH: 96,
  // Auto picks TV for a couch-shaped screen (large, near 16:9) that is being driven by a
  // controller or by no pointer at all — a desktop monitor with a mouse stays Desktop.
  auto: {
    get minW() { return TV.minViewport.w; },
    get minH() { return TV.minViewport.h; },
    minAspect: 1.55, maxAspect: 1.95,
    stayAspect: [1.2, 3.6],
  },
};
const tvTooSmall = (vw, vh, cfg = TV) => (vw < cfg.minViewport.w || vh < cfg.minViewport.h);
const resolveDisplayMode = (pref, env = {}) => {
  if (pref === 'tv' || pref === 'desktop') return pref;
  const a = TV.auto, w = env.w || 0, h = env.h || 0, aspect = h ? w / h : 0;
  const couch = w >= a.minW && h >= a.minH;
  const minAsp = env.current === 'tv' ? a.stayAspect[0] : a.minAspect;
  const maxAsp = env.current === 'tv' ? a.stayAspect[1] : a.maxAspect;
  return couch && aspect >= minAsp && aspect <= maxAsp && (env.gamepad || env.noPointer) ? 'tv' : 'desktop';
};
// Any stored or half-formed fit becomes four in-range edges snapped to the step.
const normalizeScreenFit = (v, cfg = TV) => {
  const out = {}, f = cfg.fit;
  for (const e of FIT_EDGES) {
    const n = v && Number.isFinite(v[e]) ? v[e] : cfg.screenFit[e];
    out[e] = Math.round(Math.min(f.max, Math.max(f.min, n)) / f.step) * f.step;
    out[e] = +out[e].toFixed(4);
  }
  return out;
};
// The stage in real pixels: one uniform scale, centred, with the safe rect in logical px.
const tvStage = (vw, vh, cfg = TV, fit = cfg.screenFit) => {
  const scale = Math.max(1e-4, Math.min(vw / cfg.logicalW, vh / cfg.logicalH));
  const w = cfg.logicalW * scale, h = cfg.logicalH * scale, f = normalizeScreenFit(fit, cfg);
  const x = Math.round(cfg.logicalW * f.left), y = Math.round(cfg.logicalH * f.top);
  const r = Math.round(cfg.logicalW * f.right), b = Math.round(cfg.logicalH * f.bottom);
  return { scale, w, h, x: (vw - w) / 2, y: (vh - h) / 2,
    safe: { x, y, w: cfg.logicalW - x - r, h: cfg.logicalH - y - b } };
};
/* Layout specs. `cards` is how many player cards frame the field (alternating left/right,
   filled from the bottom), `cardH` their height, and `hud` whether the co-op HUD replaces the
   canvas one. Battle keeps its own canvas strip, so it only borrows the stage. */
const TV_LAYOUTS = {
  coop2:  { cards: 2, cardH: 300, hud: true },
  coop3:  { cards: 0, cardH: 0, hud: true },
  coop:   { cards: 4, cardH: 196, hud: true },
  battle: { cards: 0, cardH: 0,   hud: false },
};
const tvLayoutKey = (mode, players) => mode === 'battle' ? 'battle' : players === 2 ? 'coop2' : players === 3 ? 'coop3' : 'coop';
/* Logical rects for one layout. `aspect` is the world's width / height, so an online room
   with a taller shared field just narrows the playfield and widens the columns. A calibrated
   `fit` moves every critical rect with the safe area; the playfield only scales uniformly
   (never stretches) and centres on the safe rect, and may still bleed past it. */
const tvLayout = (key, aspect, players, cfg = TV, fit = cfg.screenFit) => {
  const spec = TV_LAYOUTS[key] || TV_LAYOUTS.coop, safe = tvStage(cfg.logicalW, cfg.logicalH, cfg, fit).safe;
  const ph = Math.min(cfg.logicalH, safe.h * cfg.playfieldScale), pw = ph * aspect;
  const cx = safe.x + safe.w / 2, cy = safe.y + safe.h / 2;
  const playfield = { x: Math.min(cfg.logicalW - pw, Math.max(0, cx - pw / 2)),
    y: Math.min(cfg.logicalH - ph, Math.max(0, cy - ph / 2)), w: pw, h: ph };
  const top = safe.y, bottom = safe.y + safe.h, g = cfg.rowGap, c = cfg.chrome;
  const L = { x: safe.x, w: playfield.x - cfg.gap - safe.x };
  const Rx = playfield.x + pw + cfg.gap, Rc = { x: Rx, w: safe.x + safe.w - Rx };
  const n = Math.min(spec.cards, players), rows = Math.ceil(n / 2);
  const below = top + cfg.headH + g, padEnd = below + cfg.powerH + g + cfg.padH;
  // A tall inset squeezes the cards before it lets them climb into the power / pad rows.
  const cardH = rows ? Math.min(spec.cardH, (bottom - padEnd - g - (rows - 1) * g) / rows) : 0;
  const cards = [];
  for (let i = 0; i < n; i++) {
    const col = i % 2 ? Rc : L, row = Math.floor(i / 2);
    cards.push({ x: col.x, y: bottom - (rows - row) * cardH - (rows - row - 1) * g, w: col.w, h: cardH });
  }
  const cardsTop = n ? bottom - rows * cardH - (rows - 1) * g : bottom;
  return { key, hud: spec.hud, playfield, safe, cards,
    chromeL: { x: L.x, y: top, w: c, h: c },
    chromeR: { x: Rc.x + Rc.w - c, y: top, w: c, h: c },
    score: { x: L.x + c + 16, y: top, w: L.w - c - 16, h: cfg.headH },
    round: { x: Rc.x, y: top, w: Rc.w - c - 16, h: cfg.headH },
    power: { x: L.x, y: below, w: L.w, h: cfg.powerH },
    pad: { x: L.x, y: below + cfg.powerH + g, w: L.w, h: cfg.padH },
    info: { x: Rc.x, y: below, w: Rc.w, h: Math.max(0, cardsTop - g - below) },
  };
};
/* Spatial focus for d-pad and stick: from the focused rect, the nearest candidate whose
   centre lies in the pressed direction, weighing drift across the axis double so a row of
   segment buttons walks sideways and up / down steps between rows. Nothing that way: up /
   down wraps to the far end of the list, left / right stays put. Returns an index or -1. */
const spatialPick = (rects, at, dx, dy) => {
  const cur = rects[at]; if (!cur) return rects.length ? 0 : -1;
  const c = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }), o = c(cur);
  let best = -1, score = Infinity;
  rects.forEach((r, i) => {
    if (i === at) return;
    const p = c(r), along = (p.x - o.x) * dx + (p.y - o.y) * dy, across = Math.abs((p.x - o.x) * dy) + Math.abs((p.y - o.y) * dx);
    // Stacked controls share a centre line, so "in that direction" is an edge test too.
    const beyond = dx > 0 ? r.x >= cur.x + cur.w - 2 : dx < 0 ? r.x + r.w <= cur.x + 2 : dy > 0 ? r.y >= cur.y + cur.h - 2 : r.y + r.h <= cur.y + 2;
    if (along <= 0 || !beyond) return;
    const s = along + across * 2;
    if (s < score) { score = s; best = i; }
  });
  if (best < 0 && dy) {
    // Wrap: the top-most (or bottom-most) control, nearest the current column.
    const ys = rects.map(r => r.y + r.h / 2), edge = dy > 0 ? Math.min(...ys) : Math.max(...ys);
    rects.forEach((r, i) => { if (i === at || Math.abs(ys[i] - edge) > 4) return;
      const s = Math.abs(c(r).x - o.x); if (s < score) { score = s; best = i; } });
  }
  return best;
};
/* Standard-mapping gamepad buttons. In play: stick / d-pad aims, A or RT fires, LB passes left, RB or X passes right, Y fires Team Power, B toggles a reserve bomb, Start pauses, Back opens settings. In menus the same
   stick moves focus (left / right also steps a picker or slider), A presses, B backs out. */
const GAMEPAD = {
  btn: { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 },
  dead: 0.35, repeatFirst: 0.42, repeat: 0.16,
};
/* tv-display:end */

/* stick-calibration:begin
   Radial filtering precedes speed mapping; horizontal projection preserves direction.
   Browser IDs identify models, not serial numbers. Duplicate models use connection-order
   profiles and remain independent in-session; their physical identity cannot be recovered. */
const STICK_DEFAULT = 0.18;
const stickValue = v => Number.isFinite(v) ? clamp(v, -1, 1) : 0;
const stickAnalog = (x, y, dead) => {
  const magnitude = Math.hypot(x, y);
  return magnitude <= dead ? 0 : x / magnitude * clamp((magnitude - dead) / (1 - dead), 0, 1);
};
const stickRecommendation = maximum => Math.min(0.5, Math.max(0.02, Math.ceil((maximum + 0.02) * 100) / 100));
/* stick-calibration:end */

class CoopBubbles extends HTMLElement {
  connectedCallback() {
    if (this._init) return; this._init = true;
    this.setViewH(H0); // measure() refines this once .root has a box
    this.online = false; this.onlinePlayerId = null; this.onlineRoom = null; this.onlineSeq = 0;
    this.settings = { players:2, human:[true,true,false,false], botSkill:'normal',
      reload:1.35, missMax:12, rescueDur:4, assist:0.35, pressureShots:8, hurry:8, mateLines:true, sound:true, mode:'clear', field:'classic', campaign:'original', guide:0.25, level:0,
      aimSpeed:2.4, padTint:0.025, fireScale:1, aimMode:'halves', displayMode:'auto', screenFit:normalizeScreenFit(TV.screenFit) };
    Object.assign(this.settings, this.loadLocalPrefs());
    this.buildDOM();
    this.resetGame();
    this.state = 'home';
    this.bindInput();
    this.simHz = FRAME.simHz;
    let q = null; try { q = new URLSearchParams(location.search); } catch (_) {}
    if (q && Number(q.get('sim')) > 0) this.simHz = clamp(Math.round(Number(q.get('sim'))), ...FRAME.simHzRange);
    if (q && q.has('perf')) this.perfToggle(true);
    this.warmAssets();
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
      if (DISPLAY_MODES.includes(p.displayMode)) out.displayMode = p.displayMode;
      if (p.screenFit && typeof p.screenFit === 'object') out.screenFit = normalizeScreenFit(p.screenFit);
      return out;
    } catch (_) { return {}; }
  }
  saveLocalPrefs() {
    const { aimSpeed, padTint, fireScale, aimMode, displayMode, screenFit } = this.settings;
    try { localStorage.setItem('bt_prefs', JSON.stringify({ aimSpeed, padTint, fireScale, aimMode, displayMode, screenFit })); } catch (_) {}
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
    this._dprUnbind && this._dprUnbind();
    this._fullscreenUnbind && this._fullscreenUnbind();
    clearTimeout(this._reconnectTimer);
    clearTimeout(this._toastTimer);
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
    if (this.settings.mode === 'battle' && !this.online) { this.profileKey = 'classic'; this.resetBattle(); return; }
    this.battle = null; this._outro = null;
    if (!carry) {
      this._runStartLevel = this.settings.level;
      this._runStartCampaign = this.settings.campaign || 'original';
      this._pendingLevel = null;
      this._geoLocked = false;
      if (!this.online) {
        if (this.tvActive) this.setViewH(H0);
        else if (this._deviceViewH) this.setViewH(this._deviceViewH);
      }
    }
    /* The grid profile sets the field's width; the view width (VW) follows it, so the
       whole 16/15 board is the composition rather than a window panning across it. */
    this.profileKey = this.gridProfile();
    if (this.settings.field === 'wide') this.cols = Math.floor((W * 4 - 2 * X0) / (2 * R));
    else this.cols = GRID_PROFILES[this.profileKey].evenColumns;
    this.WW = this.settings.field === 'wide' ? W * 4 : 2 * X0 + 2 * R * this.cols;
    this.grid = new Map(); this.parityFlip = 0; this.anchorRow = 0;
    this.gridTop = GRIDTOP0; this.gridTopTarget = GRIDTOP0;
    const layout = this.levelLayout(), rows = layout.rows;
    const offs = this.settings.field === 'wide' ? [1, 12, 23, 34] : [layout.off];
    for (const off of offs) rows.forEach((row, r) => { for (let i = 0; i < row.length; i++) {
      const cell = levelCell(row[i]), c = i + off;
      if (cell) this.grid.set(key(r,c), { r, c, ...cell, special: (this.settings.campaign || 'original') === 'original' && this.settings.level === 34 && r === 1 && i === 4 && this.settings.human.filter(Boolean).length >= 3 && this.settings.mode === 'clear' ? 'triLock' : cell.special, contributors: [], placedBy: -1 });
    }});
    this.levelColors = levelColors(rows);
    // quietly purge any unsupported bubbles (bad custom levels)
    const safe0 = new Set(), st0 = [];
    this.grid.forEach((b,k) => { if (b.r === 0) { safe0.add(k); st0.push(b); } });
    while (st0.length) { const b = st0.pop();
      for (const [nr,nc] of this.neighbors(b.r,b.c)) { const k = key(nr,nc), nb = this.grid.get(k);
        if (nb && !safe0.has(k)) { safe0.add(k); st0.push(nb); } } }
    [...this.grid.keys()].forEach(k => { if (!safe0.has(k)) this.grid.delete(k); });
    const level = this.settings.level === 'custom' ? null : { name: layout.name, rows, objects: layout.objects };
    const objectHumans = (this.settings.human || []).filter(Boolean).length;
    this.objects = CoopObjects.create(level || {name:'Custom',rows}, this.settings.mode === 'clear' && objectHumans >= 2, objectHumans)
      .flatMap(o => offs.map((off,i) => {
        const copy = structuredClone(o); copy.id += `_${i}`; if (copy.pair) copy.pair += `_${i}`;
        copy.cells.forEach(c => { c[1] += off; }); copy.barrier?.forEach(c => { c[1] += off; }); return copy;
      }));
    this.objectAlone = 0; this.objectFallback = false;
    if (!carry) this.objectHintsShown = new Set();
    this.flights = []; this.falling = []; this.fx = []; this.pops = []; this.callouts = []; this.sfxLog = [];
    this.sparks = []; this.ripples = []; this.teamFx = []; this.chainFx = null; this.passFx = null; this.passCd = 0;
    this.teamPowerCharge = carry ? (carry.teamPowerCharge || 0) : 0; this.teamPowerActive = null; this.teamPowerTimer = 0; this.powerFx = null;
    this.dispScore = carry ? carry.score : 0;
    this.batch = []; this.resolveAt = 0; this.shotCount = 0; this.specialFlip = 0; this.specialWho = 0;
    this.score = carry ? carry.score : 0;
    this.missMeter = 0; this.pressure = 0; this.danger = null; this.shake = 0;
    if (!carry) this.now = 0;
    this.levelStartT = this.now; // mirrors OnlineGame.reset: the clear clock only runs in play
    this.chain = { mult:1, last:-1, same:0, players:new Set(), t:0, trioAwarded:false };
    this.rowTimer = 0; this.lowestY = 0;
    this.spawnPlayers(carry);
    const pf0 = this.players[this.activeP] || this.players[0];
    this.camX = clamp(pf0.x - this.VW / 2, 0, Math.max(0, this.WW - this.VW));
    this.updateLowest();
    if (this.state !== 'tutorial') this.state = 'play';
    this.showObjectGuide();
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
        bombs:this.settings.mode === 'clear' && n >= 2 ? 3 : 0, bombLoaded:false, bombStored:null,
        bot: !this.settings.human[i], think: rnd(0.4,1.2), plan: null, held: {},
        stats: (carry && old) ? old.stats : { shots:0, pops:0, bubbles:0, assists:0, drops:0, rescues:0, chains:0 } });
    }
    this.activeP = this.players.findIndex(p => !p.bot); if (this.activeP < 0) this.activeP = 0;
  }
  levelRows() { return this.levelLayout().rows; }
  // The saved custom board as classic 11/10 rows, or null when it has no colour to play.
  customRows() {
    let t = this.customText;
    if (t === undefined) { try { t = localStorage.getItem('bt_custom_level') || ''; } catch(e) { t = ''; } }
    const rows = t.split('\n').map(s => s.trim().toUpperCase().replace(/[^RGYBPO#*+.]/g, '.')).filter(s => s.length)
      .slice(0, 12).map((s, r) => { const n = (r % 2) ? 10 : 11; return (s + '.'.repeat(n)).slice(0, n); });
    return rows.some(s => /[RGYBPO]/.test(s)) ? rows : null;
  }
  // Mirrors OnlineGame.levelDrop: authored pace, or none for a custom board.
  levelDrop() { return this.settings.level === 'custom' ? 0 : this.levelLayout().drop; }
  /* Campaign 2 is intrinsically a two-player 16/15 campaign. The original campaign keeps
     its existing local-2P behavior, including its authored coop2 variants where present. */
  gridProfile() {
    const S = this.settings, campaign = S.campaign || 'original';
    return !this.battle && S.mode === 'clear' && S.players === 2 && S.field !== 'wide'
      && (!this.online || campaign === 'coop2') ? 'coop2' : 'classic';
  }
  activeLevels() { return campaignLevels(this.settings.campaign || 'original'); }
  /* The active round on the active campaign/profile. Campaign 2 rows are already 16/15;
     the original campaign still flows through levelLayout so nothing about it is rewritten. */
  levelLayout() {
    const campaign = this.settings.campaign || 'original', profile = this.profile;
    const custom = campaign === 'original' && this.settings.level === 'custom' && this.customRows();
    if (custom) return levelLayout({ name: 'Custom', rows: custom, drop: 0 }, profile);
    const L = campaignLevel(campaign, this.settings.level);
    if (campaign === 'coop2') return { name:L.name, rows:L.rows, drop:L.drop, objects:L.objects, off:0 };
    return levelLayout(L, profile);
  }
  roundName(i) {
    const campaign=this.settings.campaign||'original', L=campaignLevels(campaign)[i];
    if(!L) return null;
    return campaign==='coop2' ? L.name : levelLayout(L,this.profile).name;
  }
  // The profile in play: a room or a battle never inherits a local two-player board.
  get profile() { return !this.battle && this.profileKey === 'coop2' && (!this.online || (this.settings.campaign||'original')==='coop2') ? 'coop2' : 'classic'; }
  /* The world width the canvas shows. The coop2 board is shown whole, so its view is its
     field and the camera has nowhere to go; elsewhere the view is the classic 640 (the
     wide 4× field scrolls beneath it). */
  get VW() { return this.profile === 'coop2' ? this.WW : W; }
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
    this.players.forEach(p => ['cur','next','bombStored'].forEach(slot => {
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
        if (b && !CoopObjects.protectedCell(this,k) && (b.kind === kind || b.special === 'rainbow')) { seen.add(k); st.push([nr,nc]); }
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
      kind: p.cur.kind, special: p.cur.special, trail: [], bounceCd: 0, at: this.now });
    if (!bombRestoreAfterFire(p)) { p.cur = p.next; p.next = this.genBubble(); }
    p.reload = this.settings.reload; p.stats.shots++; p.recoilT = this.now; p.idle = 0;
    CoopObjects.shot(this);
    if (!powerHolds(this.teamPowerActive, 'holdPressure')) { this.pressure++; this.dropWarnSfx(); }
    for (let s = 0; s < 5; s++) this.sparks.push({ x: sx + Math.sin(a) * 34, y: sy - Math.cos(a) * 34,
      vx: Math.sin(a) * rnd(60, 180) + rnd(-40, 40), vy: -Math.cos(a) * rnd(60, 180) + rnd(-40, 40),
      g: 0, t: this.now, life: 0.35, color: 'rgba(255,255,255,0.85)', sz: rnd(4, 8), soft: true });
    this.sfx('launch');
  }
  /* There is no swap. You shoot the colour you were dealt: the queue is a constraint to play
     around, not one you can reorder, and 'next' is there to plan the shot after this one.
     refreshQueues() still recolours a queued bubble whose colour has left the field, which is
     what the pod pulse and the 'swap' cue now mark. */
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
      // The trail is presentation: sampled on its own clock, so its length on screen does not
      // depend on how many simulation steps a frame took.
      f.trailT = (f.trailT ?? TRAIL_DT) + dt;
      if (f.trailT >= TRAIL_DT) { f.trailT = Math.min(f.trailT - TRAIL_DT, TRAIL_DT);
        f.trail.push({ x: f.x, y: f.y }); if (f.trail.length > 16) f.trail.shift(); }
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
    const object = CoopObjects.hit(this, f.x, f.y);
    if (object) { CoopObjects.interact(this, object, f.p); return; }
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
    const b = { r: cell.r, c: cell.c, kind: f.kind, special: f.special, placedBy: f.p, at: this.now, fired: f.at,
      snapFrom: { x: f.x, y: f.y }, snapT: this.now };
    this.grid.set(key(cell.r, cell.c), b);
    this.markTriLocks(b);
    this.ripples.push({ x: this.cellX(cell.r, cell.c), y: this.cellY(cell.r), t: this.now });
    this.batch.push(b);
    if (!this.resolveAt) this.resolveAt = this.now + 0.2; // generous simultaneous-landing window
    this.updateLowest();
    this.sfx('attach');
  }

  markTriLocks(b) {
    const humans = this.teamHumans();
    if (humans.length < 3 || !humans.includes(b.placedBy)) return;
    for (const [r,c] of this.neighbors(b.r,b.c)) {
      const lock = this.grid.get(key(r,c)); if (!lock || lock.special !== 'triLock') continue;
      lock.contributors ||= [];
      if (lock.contributors.includes(b.placedBy)) continue;
      lock.contributors.push(b.placedBy);
      const unlocked = lock.contributors.length >= 3;
      if (unlocked) { lock.special = 'star'; this.score += 200; }
      this.showTriLock({ r, c, by:b.placedBy, contributors:[...lock.contributors], unlocked });
    }
  }
  objectWhere(o) { const [r,c] = o.cells[0]; return {x:this.cellX(r,c),y:this.cellY(r),r,c}; }
  objectEvent(kind,data) { this.showObjectEvent(kind,data); }
  objectReward(by,setup,where) {
    this.score += 150;
    if (this.players[setup]) this.players[setup].stats.assists++;
    const handoff = this._resolvingBatch ? 0 : (this.registerClear(by) ? 1 : 0);
    const team = {assists:[{by,setup:[setup]}],rescue:null,drop:null,bonus:150};
    this.showTeamPlay(team,where);
    this.chargeTeamPower(team,handoff,where);
  }
  objectRemove(keys,by) {
    for (const k of keys) { const b=this.grid.get(k); if (!b) continue; this.grid.delete(k);
      this.pops.push({x:this.cellX(b.r,b.c),y:this.cellY(b.r),kind:b.kind,special:b.special,t:this.now,parts:[]}); }
    this.supportCheck(); this.updateLowest(); this.refreshQueues();
    CoopObjects.removed(this);
    if (this.settings.mode === 'clear' && !this.grid.size && this.state === 'play') this.clearLevel();
  }
  showObjectEvent(kind,d) {
    if (kind === 'object_warning') { this.callout('PRESSURE ABOUT TO SPREAD!', '#d772ea'); this.sfx('pressure'); return; }
    if (kind === 'object_spread') { this.sfx('pressure'); this.callout('PRESSURE SPREADS!', '#9b69d8'); return; }
    if (kind === 'object_fallback') { this.callout('SOLO FALLBACK ACTIVE', '#8fdcff'); return; }
    if (kind === 'object_complete') {
      const label = d.type === 'syncLock' ? 'SYNC!' : d.type === 'teamArmor' ? 'ARMOR BROKEN!' : 'SHIELD CLEARED!';
      this.callout(label + (d.cooperative ? ' +150' : ''), '#8fdcff'); this.sfx('teamPower');
      this.shake = Math.max(this.shake || 0,8); return;
    }
    if (kind === 'object_state' && d.state === 'done' && d.type === 'corruption') {
      this.callout('PRESSURE STOPPED!', '#3ecf72'); this.sfx('rescue'); return;
    }
    if (kind === 'object_state' && (d.state === 'exposed' || d.state === 'armed' || d.state === 'marked')) {
      this.addPopup({x:d.x,y:d.y}, d.state === 'exposed' ? 'SHIELD DOWN' : d.state === 'armed' ? 'LOCK ARMED' : 'ARMOR 1/2', (META[d.by] || META[0]).accent);
      this.sfx('chain');
    }
  }
  showObjectGuide() {
    this.objectHintsShown ||= new Set();
    const guide = {shield:'SHIELD: BREAK IT, THEN TEAMMATE CLEARS',syncLock:'LOCKS: DIFFERENT PLAYERS, 5 SECONDS',
      teamArmor:'ARMOR: BOTH PLAYERS MUST HIT',corruption:'PRESSURE: CLEAR THE DARK NODE'};
    for (const o of this.objects || []) if (!this.objectHintsShown.has(o.type)) {
      this.objectHintsShown.add(o.type); this.callout(guide[o.type], '#8fdcff');
    }
  }
  showTriLock(d) {
    const col = (META[d.by] || META[0]).accent;
    if (d.unlocked) { this.callout('TRI-LOCK OPEN! +200', col); this.sfx('teamPower'); this.shake = Math.max(this.shake || 0, 9); }
    else { this.addPopup({ x:this.cellX(d.r,d.c), y:this.cellY(d.r) }, d.contributors.length + '/3 LOCK', col); this.sfx('chain'); }
  }
  /* ---------- batch resolution ---------- */
  resolveBatch() {
    this._resolvingBatch = true;
    const landed = this.batch; this.batch = []; this.resolveAt = 0;
    const results = []; // {shooter, popped:Set|null}
    for (const b of landed) {
      if (!this.grid.get(key(b.r, b.c))) { results.push({ shooter: b.placedBy, at: b.fired, popped: null, gone: true }); continue; }
      if (b.special === 'bomb') {
        const bx = this.cellX(b.r, b.c), by = this.cellY(b.r), blast = new Set([key(b.r,b.c)]);
        this.grid.forEach((g,k) => { if (g.special !== 'stone' && g.special !== 'triLock' && Math.hypot(this.cellX(g.r,g.c) - bx, this.cellY(g.r) - by) <= R * 4.3) blast.add(k); });
        results.push({ shooter: b.placedBy, at: b.fired, popped: blast, bomb: true });
      } else {
        let kind = b.kind;
        if (b.special === 'rainbow') { // adopt the biggest adjacent color group
          let best = null, bs = 0;
          for (const [nr,nc] of this.neighbors(b.r,b.c)) {
            const nb = this.grid.get(key(nr,nc));
            if (nb && !nb.special) { const s = this.matchGroup(b.r, b.c, nb.kind).size; if (s > bs) { bs = s; best = nb.kind; } }
          }
          if (best) kind = best; else { results.push({ shooter: b.placedBy, at: b.fired, popped: null }); continue; }
        }
        const g = this.matchGroup(b.r, b.c, kind), star = starHit(this.grid, this.neighbors(b.r, b.c), b, kind);
        if (star) { g.forEach(k => star.add(k)); results.push({ shooter: b.placedBy, at: b.fired, popped: star, star: true }); continue; }
        results.push({ shooter: b.placedBy, at: b.fired, popped: g.size >= 3 ? g : null });
      }
    }
    // pop everything, collect owners
    const allPopped = new Set(); let popN = 0; const owners = new Set(); const clearers = [], shots = [];
    for (const r of results) {
      if (!r.popped) continue;
      const fresh = [];
      r.popped.forEach(k => { if (!allPopped.has(k) && this.grid.has(k) && !CoopObjects.protectedCell(this,k)) {
        const b = this.grid.get(k);
        CoopObjects.onPop(this,k,r.shooter);
        if (b.placedBy >= 0 && b.placedBy !== r.shooter) owners.add(b.placedBy);
        allPopped.add(k); fresh.push(b);
      }});
      if (fresh.length) { clearers.push(r.shooter); shots.push({ shooter: r.shooter, at: r.at, bubbles: fresh }); }
      popN += fresh.length;
    }
    allPopped.forEach(k => {
      const b = this.grid.get(k); this.grid.delete(k);
      this.pops.push({ x: this.cellX(b.r,b.c), y: this.cellY(b.r), kind: b.kind, special: b.special, t: this.now,
        parts: Array.from({ length: 8 }, () => ({ a: rnd(0, 6.28), sp: rnd(100, 320), sz: rnd(3, 6.5) })) });
    });
    // unsupported drop check
    const dropped = this.supportCheck();
    this.updateLowest();
    CoopObjects.removed(this);
    // Same rules as OnlineGame.resolveBatch: what the shot removed and who placed it. The
    // rescue half is decided at the rescue, after any ceiling descent.
    const humans = this.teamHumans(), teamOn = humans.length >= 2;
    const where = popN + dropped.n ? { x: (this.centerOf(allPopped).x * popN + (dropped.x || 0) * dropped.n) / (popN + dropped.n),
      y: (this.centerOf(allPopped).y * popN + (dropped.y || 0) * dropped.n) / (popN + dropped.n) } : null;
    let team = teamPlay(TEAM, humans, shots, dropped.bubbles || [], false), handoffs = 0;
    // scoring / chain / meters
    if (popN > 0) {
      clearers.forEach(s => { if (this.registerClear(s)) handoffs++; });
      const mult = this.chain.mult;
      const pts = this.popPoints(popN) * mult;
      this.score += pts; this.addPopup(this.centerOf(allPopped, this.pops), '+' + pts, '#17335c');
      clearers.forEach(s => { const p = this.players[s]; if (p) { p.stats.pops++; p.stats.bubbles += popN; } });
      (teamOn ? new Set(team.assists.flatMap(a => a.setup)) : owners).forEach(o => { const p = this.players[o]; if (p) p.stats.assists++; });
      if (!teamOn && owners.size >= 1) this.callout(owners.size + clearers.length >= 3 ? 'TEAM POP!' : 'ASSIST!', '#a78bfa');
      this.missMeter = Math.max(0, this.missMeter - 1);
      this.sfx(popN >= 6 ? 'bigpop' : 'pop');
      if (results.some(r => r.bomb && r.popped)) this.callout('KABOOM!', '#ff8a3c');
      if (results.some(r => r.star)) this.callout('STAR BURST!', '#e0a100');
    }
    // misses: every landed shot that didn't pop counts one miss (per spec), even if a teammate popped in the same batch.
    // A power that holds the pressure holds the miss meter too, as OnlineGame does.
    let misses = 0;
    if (!powerHolds(this.teamPowerActive, 'holdPressure')) for (const r of results) if (!r.popped && !r.gone && !r.bomb) misses++;
    if (misses) {
      this.missMeter += misses;
      if (this.missMeter >= this.missLimit() * 0.6) { this.chain.mult = 1; this.chain.players.clear(); this.chain.trioAwarded = false; }
      if (this.missMeter >= this.missLimit()) this.ceilingDescend();
    }
    // drops
    if (dropped.n > 0) {
      const pts = this.dropPoints(dropped.n, dropped.comps) * this.chain.mult;
      this.score += pts;
      clearers.forEach(s => { const p = this.players[s]; if (p) p.stats.drops += dropped.n; });
      this.addPopup({ x: dropped.x, y: dropped.y }, '+' + pts, '#ff8a3c');
      if (dropped.comps >= 2) this.callout('DOUBLE CUT!', '#35d3c8');
      else if (dropped.n >= 5 && !(team.drop && TEAM.feedback)) this.callout('HUGE DROP!', '#ff8a3c');
      this.missMeter = dropped.n >= 8 ? 0 : Math.max(0, this.missMeter - 3);
      this.shake = Math.min(14, 4 + dropped.n * 1.2);
      this.sfx('drop');
    }
    // rescue?
    if (this.danger && !this.anyDangerCells()) {
      if (team.assists.length) team = teamPlay(TEAM, humans, shots, dropped.bubbles || [], true);
      this.danger = null; this.score += 500; this.missMeter = Math.max(0, this.missMeter - 3);
      clearers.forEach(s => { const p = this.players[s]; if (p) p.stats.rescues++; });
      if (!(team.rescue && TEAM.feedback)) this.callout('TEAM RESCUE! +500', '#3ecf72');
      this.sfx('rescue');
    }
    if (team.bonus) { this.score += team.bonus; this.showTeamPlay(team, where); }
    if (teamOn) this.chargeTeamPower(team, handoffs, where);
    this.refreshQueues();
    // victory (coop clear)
    if (this.settings.mode === 'clear' && this.grid.size === 0 && this.state === 'play') this.clearLevel();
    this._resolvingBatch = false;
  }
  /* ---------- clear-mode level chain (mirrors OnlineGame.clearLevel) ---------- */
  levelIndex() { return this.settings.level === 'custom' ? -1 : (Number(this.settings.level) || 0); }
  nextLevelIndex() {
    const i = this.levelIndex();
    return i >= 0 && i + 1 < this.activeLevels().length ? i + 1 : -1;
  }
  levelBonus() {
    let shots = 0, pops = 0;
    for (const p of this.players) { shots += p.stats.shots; pops += p.stats.pops; }
    const accuracy = shots ? pops / shots : 0;
    const headroom = Math.max(0, this.missLimit() - this.missMeter) / Math.max(1, this.missLimit());
    return Math.round(accuracy * 1500) + Math.round(headroom * 500);
  }
  clearLevel() {
    const from = this.levelIndex(), next = this.nextLevelIndex(), bonus = this.levelBonus();
    const secs = Math.max(0, this.now - this.levelStartT), timeBonus = clearTimeBonus(secs);
    const bombBonus = this.players.reduce((sum, p) => sum + unusedBombs(p) * 250, 0);
    this.score += bonus + timeBonus + bombBonus;
    if (from >= 0) this.recordProgress(from);
    if (next < 0) return this.endGame(true);
    this.state = 'levelup'; this.sfx('win');
    this._pendingLevel = next;
    // Everyone on this device is looking at the same screen, so one Continue is the gate.
    const card = { from, next, bonus, timeBonus, secs, score: this.score, rows: this.playerStatRows(this.players) };
    this.beginOutro(() => this.showLevelCard(card));
  }
  /* One row per player, the same shape the game-over card uses. It takes plain rows rather
     than players because online the numbers come from the server's summary. */
  statRowsHTML(rows) {
    return rows.map(r => `<div class="statRow${r.team ? ' team' : ''}"><span class="who" style="color:${r.accent}">${r.name}</span>
       <span class="nums">${r.nums}</span></div>`).join('');
  }
  /* Co-op leads with what the team did together; the rows under it are who did what.
     Solo has no team to total, so it keeps its single row. */
  playerStatRows(players) {
    const list = players || [], nums = s => `${s.shots || 0} shots · ${s.pops || 0} pops · ${s.bubbles || 0} cleared · ${s.drops || 0} dropped · `
      + `${s.assists || 0} setups · ${s.rescues || 0} rescues · ${s.chains || 0} chain`;
    const rows = list.map(p => {
      const meta = p.meta || META[p.i] || META[0];
      return { name: meta.name, accent: meta.accent, nums: nums(p.stats || {}) + ((this.state === 'levelup' || this.state === 'won') && this.settings.mode === 'clear' && list.length >= 2 ? ' · Bomb Bonus: ' + unusedBombs(p) + ' × 250 = ' + unusedBombs(p) * 250 : '') };
    });
    if (list.length < 2) return rows;
    const sum = {};
    for (const p of list) for (const [k, v] of Object.entries(p.stats || {})) sum[k] = (sum[k] || 0) + (Number(v) || 0);
    // The team line is the rows added up; it leads because the run was played together.
    return [{ name: 'TEAM', accent: '#2b6fd4', team: true, nums: nums(sum) + ((this.state === 'levelup' || this.state === 'won') && this.settings.mode === 'clear' ? ' · Combined Bomb Bonus: ' + list.reduce((n,p) => n + unusedBombs(p) * 250, 0) : '') }, ...rows];
  }
  /* The level card. `ready` is only present online, where the next level does not start
     until every connected player has said so (or the room's timer runs out). */
  showLevelCard({ from, next, bonus, timeBonus, secs, score, rows, ready }) {
    const sh = this.shadowRoot;
    sh.querySelector('.luTitle').textContent = '⭐ ' + (this.roundName(from) || 'Level ' + (from + 1)) + ' cleared!';
    sh.querySelector('.luSub').textContent = 'Clear bonus +' + (bonus || 0).toLocaleString()
      + ' · Score ' + (score || 0).toLocaleString() + ' · Up next: ' + (next + 1) + '. ' + (this.roundName(next) || 'Level ' + (next + 1));
    // The speed reward gets its own line: full inside PACE.timeFull, nothing by PACE.timeZero.
    sh.querySelector('.luTime').textContent = '\u23f1 Cleared in ' + Math.round(secs || 0) + 's · Time bonus +'
      + (timeBonus || 0).toLocaleString();
    sh.querySelector('.luStats').innerHTML = this.statRowsHTML(rows);
    const readyEl = sh.querySelector('.luReady'), btn = sh.querySelector('.luNext');
    if (ready) {
      readyEl.textContent = ready.count + ' / ' + ready.total + ' ready'
        + (ready.secs != null ? ' · next level in ' + ready.secs + 's' : '');
      btn.disabled = !!ready.me;
      btn.textContent = ready.me ? 'Waiting for the others' : 'Continue';
    } else { readyEl.textContent = ''; btn.disabled = false; btn.textContent = 'Continue'; }
    this.levelUpEl.style.display = 'grid';
  }
  readyForNextLevel() {
    if (this.online) { this.sendOnline('level_ready'); this.shadowRoot.querySelector('.luNext').disabled = true; return; }
    this.advanceLevel();
  }
  advanceLevel() {
    const next = this._pendingLevel;
    if (next === null || next === undefined) return;
    this._pendingLevel = null;
    this.settings.level = next;
    this.state = 'play';
    this.resetGame({ score: this.score, teamPowerCharge: this.teamPowerCharge });
    this._syncSettings?.();
  }
  /* Furthest authored level reached. Progress, not score — score lives on the server. */
  recordProgress(cleared) {
    try {
      const campaign=this.settings.campaign||'original', key='bt_progress_'+campaign;
      const legacy=campaign==='original'?Number(localStorage.getItem('bt_progress')||0):0;
      const best=Math.max(Number(localStorage.getItem(key)||0),legacy,cleared+1);
      localStorage.setItem(key,String(Math.min(best,this.activeLevels().length-1)));
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
    return { n: doomed.length, comps, x: sx / doomed.length, y: sy / doomed.length, bubbles: doomed.map(d => d[1]) };
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
    const humans = this.teamHumans(), solo = this.players.length <= 1, team = humans.length >= 2, from = ch.last;
    let handoff = false;
    if (solo || ch.last !== pi) {
      ch.mult = Math.min(ch.mult + 1, 4); ch.same = 0;
      // Mirrors OnlineGame.registerClear: every new human clearer contributes,
      // and a handoff is what the HUD celebrates.
      handoff = team && from >= 0 && from !== pi;
      if (team) { const p = this.players[pi]; if (p) p.stats.chains = (p.stats.chains || 0) + 1; }
      this.chainFx = { pulseT: this.now, handoffT: handoff ? this.now : (this.chainFx?.handoffT ?? -9), by: pi };
    }
    else if (++ch.same >= 3) { ch.mult = 1; ch.players.clear(); ch.trioAwarded = false; ch.same = 0; }
    ch.last = pi; ch.players.add(pi); ch.t = TEAM.chainSecs;
    if (ch.mult >= 2) {
      if (humans.length >= 3 && humans.filter(h => ch.players.has(h)).length === 3 && from !== pi && !ch.trioAwarded) { ch.trioAwarded = true; this.score += 300; this.showTrioChain(pi); }
      else if (humans.filter(h => ch.players.has(h)).length >= 4) { this.callout('FOUR-PLAYER BURST!', '#ff6fb1'); this.score += 400; ch.players.clear(); }
      else if (team && TEAM.feedback) { this.teamChainCallout(pi, from, ch.mult); return handoff; }
      else this.callout((solo ? 'CHAIN ×' : 'TEAM CHAIN ×') + ch.mult, '#a78bfa');
      this.sfx('chain');
    }
    return handoff; // a handoff is a Team Power chain step
  }
  showTrioChain(by) { this.callout('TRIO CHAIN! +300', (META[by] || META[0]).accent); this.shake = Math.max(this.shake || 0, 12); this.sfx('teamPower'); }
  /* ---------- co-op feedback ----------
     Local and online both land here: locally from resolveBatch, online from the server's
     team_play / team_chain events, so the client never decides a bonus for itself. */
  teamHumans() {
    if (this.battle || this.settings.mode !== 'clear' || !this.players) return [];
    const h = this.players.filter(p => !p.bot).map(p => p.i);
    return h.length >= 2 ? h : [];
  }
  teamChainCallout(by, from, mult) {
    const handoff = from >= 0 && from !== by;
    this.callout((handoff ? 'HANDOFF! ' : '') + 'TEAM CHAIN \u00d7' + mult, (META[by] || META[0]).accent);
    this.sfx(handoff ? 'handoff' : 'chain');
  }
  showTeamPlay(team, where) {
    const at = where || { x: this.WW / 2, y: 320 }, name = i => (META[i] || META[0]).name, col = i => (META[i] || META[0]).accent;
    if (!TEAM.feedback) { this.callout('ASSIST!', '#a78bfa'); this.addPopup(at, '+' + team.bonus, '#a78bfa'); return; }
    const a = team.assists[0];
    if (a && a.setup.length >= 2) { this.callout('TRIPLE ASSIST! +' + team.bonus, col(a.by)); this.shake = Math.max(this.shake || 0, 9); this.sfx('teamPower'); }
    if (a) {
      const from = a.setup[0], to = a.by;
      // A rescue or team drop already names the pair in its callout, so its burst goes
      // wordless rather than stacking a third line of text over the cluster.
      const big = !!(team.rescue || team.drop);
      this.teamFx.push({ x: at.x, y: at.y, c1: col(from), c2: col(to), t: this.now, big,
        text: big || a.setup.length >= 2 ? '' : 'TEAM ASSIST! ' + a.setup.map(name).join('+') + ' \u2192 ' + name(to) + '  +' + team.bonus });
      this.sfx('teamAssist');
    }
    if (team.rescue) {
      this.callout('TEAM RESCUE! ' + team.rescue.setup.map(name).join('+') + ' \u2192 ' + name(team.rescue.by), col(team.rescue.by));
      this.sfx('teamRescue'); this.shake = Math.max(this.shake || 0, 10);
    }
    if (team.drop) {
      this.callout((team.drop.huge ? 'HUGE TEAM DROP! ' : 'TEAM DROP! ') + team.drop.setup.map(name).join('+') + ' \u2192 ' + name(team.drop.by), col(team.drop.setup[0]));
      this.sfx('teamDrop');
    }
    if (!a || team.rescue || team.drop) this.addPopup({ x: at.x, y: at.y + 40 }, '+' + team.bonus + ' TEAM', col(a ? a.by : 0));
  }
  /* ---------- PASS ----------
     Local play runs passPair right here. Online the request only asks: the swap arrives as
     the server's `pass` event with the snapshot that already holds the traded bubbles, so a
     pass is never predicted and two partners pressing together still see one swap. */
  // Which launcher this device's PASS button speaks for, or -1 when no pass is possible.
  passPlayer() {
    const h = this.teamHumans(); if (h.length < 2) return -1;
    if (this.online) return h.includes(this.activeP) ? this.activeP : -1;
    const p = this.firstHumanPlayer(); return p && h.includes(p.i) ? p.i : -1;
  }
  padPass(direction = 1) { const i = this.passPlayer(); if (i >= 0) this.requestPass(i, direction); }
  requestBombToggle(i) {
    if (this.settings.mode !== 'clear' || this.players.length < 2 || this.state !== 'play') return;
    if (this.online) { this.sendOnline('bomb_toggle'); return; }
    const p = this.players[i];
    if (!bombToggle(p) && p && p.reload <= 0 && !unusedBombs(p)) { this.callout('OUT OF BOMBS', p.meta.accent); this.sfx('passNo'); }
  }
  requestPass(i, direction = 1) {
    const h = this.teamHumans();
    if (h.length < 2 || !h.includes(i)) return; // no pass in this game at all: stay silent
    const pair = passPair(h, this.players, i, this.state, this.passCd || 0, direction);
    if (!pair) { this.passRefused(); return; }
    if (this.online) { this.sendOnline('pass', { direction }); return; }
    passSwap(pair); this.passCd = PASS.cooldown; this.players[i].idle = 0;
    this.showPass({ by: i, players: pair.map(p => p.i) });
  }
  // Not ready: a muted click and a shake of the button, never a line of text over the board.
  passRefused() { this.passShakeT = performance.now() / 1000; this.sfx('passNo'); }
  showPass(d) {
    const [a, b] = (d.players || []).map(i => this.players[i]); if (!a || !b) return;
    const col = (META[d.by] || META[0]).accent;
    this.passFx = { t: this.now, a: a.i, b: b.i };
    this.passFlashT = performance.now() / 1000;
    this.addPopup({ x: (a.x + b.x) / 2, y: this.LAUNCH_Y - 170 }, 'PASS!', col);
    this.sfx('pass');
  }
  /* Each bubble arcs from the launcher that gave it up to the one that holds it now, over a
     streak in the giver's accent. The swap has already happened; this only shows it. */
  drawPassFx(ctx) {
    const fx = this.passFx; if (!fx) return;
    const k = (this.now - fx.t) / PASS_FX, fade = clamp(1 - (k - 1) / 0.6, 0, 1);
    if (fade <= 0) return;
    const e = Math.min(1, k), u = e * e * (3 - 2 * e), y = this.LAUNCH_Y - 44;
    for (const [from, to] of [[fx.a, fx.b], [fx.b, fx.a]]) {
      const pf = this.players[from], pt = this.players[to]; if (!pf || !pt) continue;
      const x0 = pf.x, x1 = pt.x, lift = 140 + Math.abs(x1 - x0) * 0.2;
      const at = v => ({ x: x0 + (x1 - x0) * v, y: y - Math.sin(v * Math.PI) * lift });
      const u0 = Math.max(0, u - 0.4);
      ctx.globalAlpha = 0.55 * fade; ctx.strokeStyle = (META[from] || META[0]).accent;
      ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.beginPath();
      for (let s = 0; s <= 14; s++) { const q = at(u0 + (u - u0) * s / 14); if (s) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
      ctx.stroke(); ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
      if (k < 1 && pt.cur) { const q = at(u); this.drawBubble(ctx, q.x, q.y, 22, pt.cur.kind, pt.cur.special, false, false); }
    }
    ctx.globalAlpha = 1;
  }
  /* The PASS button exists only while this device could pass. Its fill is the shared
     cooldown, so both partners watch the same clock; it flashes on a pass and shakes when
     pressed early. Button timers run on the wall clock so a pause cannot freeze them on. */
  syncPassButton() {
    const el = this.passBtn, left = this.passLeftBtn; if (!el) return;
    const i = this.passPlayer(), on = i >= 0 && (this.state === 'play' || this.state === 'paused');
    if (on !== this._passOn) { this._passOn = on; el.classList.toggle('on', on); }
    const leftOn = on && this.teamHumans().length >= 3;
    if (left && leftOn !== this._passLeftOn) { this._passLeftOn = leftOn; left.classList.toggle('on', leftOn); }
    if (!on) return;
    const cd = this.passCd || 0, q = Math.round(clamp(cd / PASS.cooldown, 0, 1) * 100) / 100;
    if (q !== this._passK) { this._passK = q; el.style.setProperty('--passK', q); el.classList.toggle('cooling', q > 0);
      if (left) { left.style.setProperty('--passK', q); left.classList.toggle('cooling', q > 0); } }
    const label = cd > 0 ? 'PASS ' + Math.ceil(cd) : this.teamHumans().length >= 3 ? 'PASS \u25b6' : 'PASS';
    const leftLabel = cd > 0 ? '\u25c0 ' + Math.ceil(cd) : '\u25c0 PASS';
    if (left && left.textContent !== leftLabel) left.textContent = leftLabel;
    if (el.textContent !== label) el.textContent = label;
    const t = performance.now() / 1000;
    el.classList.toggle('flash', t - (this.passFlashT ?? -9) < 0.45);
    el.classList.toggle('shake', t - (this.passShakeT ?? -9) < 0.3);
    if (left) { left.classList.toggle('flash', t - (this.passFlashT ?? -9) < 0.45);
      left.classList.toggle('shake', t - (this.passShakeT ?? -9) < 0.3); }
    const p = this.players[i], side = p && p.x - (this.camX || 0) < this.VW / 2 ? 'left' : 'right';
    if (el.dataset.side !== side) el.dataset.side = side;
    if (left && left.dataset.side !== side) left.dataset.side = side;
  }
  /* ---------- TEAM POWER ----------
     Local play charges the meter from the same resolved team events the bonuses come from
     and runs powerPair right here. Online the server owns the meter, the check and the
     effect: the client only asks, then renders the snapshot fields and team_power_* events.
     The control speaks for the same launcher PASS does. */
  padTeamPower() { const i = this.passPlayer(); if (i >= 0) this.requestTeamPower(i); }
  requestTeamPower(i) {
    const h = this.teamHumans();
    if (h.length < 2 || !h.includes(i)) return; // no Team Power in this game at all
    const pair = powerPair(TEAM_POWER, h, this.players, i, this.state, this.teamPowerCharge || 0, this.teamPowerActive);
    if (!pair) { this.powerShakeT = performance.now() / 1000; this.sfx('passNo'); return; }
    if (this.online) { this.sendOnline('team_power'); return; }
    const power = TEAM_POWER.equipped, def = POWERS[power];
    this.teamPowerCharge = 0; this.teamPowerActive = power; this.teamPowerTimer = def.secs;
    def.start(pair);
    this.showTeamPowerActivated({ by: i, power, name: def.name, secs: def.secs, players: pair.map(p => p.i) });
  }
  // Local only; mirrors OnlineGame.chargeTeamPower.
  chargeTeamPower(team, handoffs, where) {
    const { amount, reasons } = powerCharge(TEAM_POWER, team, handoffs, this.teamPowerActive);
    if (!amount || this.teamPowerCharge >= TEAM_POWER.max) return;
    const was = this.teamPowerCharge;
    this.teamPowerCharge = Math.min(TEAM_POWER.max, was + amount);
    this.showTeamPowerCharge({ amount: this.teamPowerCharge - was, charge: this.teamPowerCharge, reasons, ...(where || {}) });
    if (this.teamPowerCharge >= TEAM_POWER.max) this.showTeamPowerReady();
  }
  endTeamPower() {
    if (!this.teamPowerActive) return;
    this.teamPowerActive = null; this.teamPowerTimer = 0;
    this.showTeamPowerEnded();
  }
  showTeamPowerCharge(d) { const fx = this.powerFx ||= {}; fx.chargeT = this.now; fx.gain = d.amount; }
  showTeamPowerReady() {
    (this.powerFx ||= {}).readyT = this.now;
    this.callout('TEAM POWER READY!', '#7b61d9'); this.sfx('powerReady');
  }
  showTeamPowerActivated(d) {
    const fx = this.powerFx ||= {};
    fx.actT = this.now; fx.by = d.by; fx.players = d.players || this.teamHumans();
    this.callout((d.name || 'SYNERGY BURST') + '!', (META[d.by] || META[0]).accent);
    this.sfx('teamPower');
  }
  showTeamPowerEnded() { (this.powerFx ||= {}).endT = this.now; this.sfx('powerEnd'); }
  /* The TEAM POWER button exists whenever this device could use it. Charging it fills
     quietly; full, it goes rainbow and breathes; running, it counts the burst down. */
  syncPowerButton() {
    const el = this.powerBtn; if (!el) return;
    const on = this.passPlayer() >= 0 && (this.state === 'play' || this.state === 'paused');
    if (on !== this._powerOn) { this._powerOn = on; el.classList.toggle('on', on); }
    if (!on) return;
    const charge = this.teamPowerCharge || 0, active = this.teamPowerActive, ready = !active && charge >= TEAM_POWER.max;
    const q = active ? 0 : Math.round(clamp(charge / TEAM_POWER.max, 0, 1) * 100) / 100;
    if (q !== this._powerK) { this._powerK = q; el.style.setProperty('--powerK', q); }
    el.classList.toggle('ready', ready); el.classList.toggle('active', !!active);
    const label = active ? 'BURST ' + Math.ceil(this.teamPowerTimer || 0) : ready ? 'TEAM POWER!' : 'POWER ' + Math.floor(q * 100) + '%';
    if (el.textContent !== label) el.textContent = label;
    el.classList.toggle('shake', performance.now() / 1000 - (this.powerShakeT ?? -9) < 0.3);
    const p = this.players[this.passPlayer()], side = p && p.x - (this.camX || 0) < this.VW / 2 ? 'right' : 'left';
    if (el.dataset.side !== side) el.dataset.side = side;
    // The corner PASS buttons use the opposite side.
  }
  /* The shared meter, centred under the score row where teammates look. It fills in
     player colours, turns rainbow and pulses when READY, and becomes the burst's
     countdown while one runs. */
  drawTeamPower(ctx) {
    const max = TEAM_POWER.max, charge = this.teamPowerCharge || 0, active = this.teamPowerActive;
    const def = active ? POWERS[active] : null, ready = !active && charge >= max, fx = this.powerFx || {};
    const w = 236, h = 24, x = this.VW / 2 - w / 2, y = 78;
    const frac = def ? clamp((this.teamPowerTimer || 0) / def.secs, 0, 1) : clamp(charge / max, 0, 1);
    const ck = fx.chargeT !== undefined ? clamp((this.now - fx.chargeT) / 0.6, 0, 1) : 1;
    const beat = Math.sin(this.now * 6);
    ctx.save();
    const s = ready ? 1 + 0.05 * beat : 1 + (1 - ck) * 0.08;
    ctx.translate(this.VW / 2, y + h / 2); ctx.scale(s, s); ctx.translate(-this.VW / 2, -(y + h / 2));
    ctx.shadowColor = ready || active ? 'rgba(123,97,217,0.6)' : 'rgba(40,80,140,0.18)';
    ctx.shadowBlur = ready ? 14 + 8 * beat : 10; ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; this.rrect(ctx, x, y, w, h, h / 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    if (frac > 0) {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      if (ready || active) { const o = (this.now * 90) % 360; for (let i = 0; i <= 4; i++) g.addColorStop(i / 4, 'hsl(' + ((o + i * 72) % 360) + ',85%,64%)'); }
      else { g.addColorStop(0, META[0].accent); g.addColorStop(1, META[1].accent); }
      ctx.save(); this.rrect(ctx, x, y, w, h, h / 2); ctx.clip();
      ctx.fillStyle = g; ctx.fillRect(x, y, w * frac, h); ctx.restore();
    }
    ctx.strokeStyle = ready || active ? '#7b61d9' : 'rgba(123,97,217,0.45)'; ctx.lineWidth = 2;
    this.rrect(ctx, x, y, w, h, h / 2); ctx.stroke();
    this._coarse ??= typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const label = def ? def.name + '  ' + Math.max(0, this.teamPowerTimer || 0).toFixed(1) + 's'
      : ready ? 'TEAM POWER READY' + (this._coarse ? '' : ' \u00b7 Q') : 'TEAM POWER ' + Math.floor(charge) + '%';
    ctx.textAlign = 'center'; ctx.font = '700 14px Fredoka, sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(label, this.VW / 2, y + 17);
    ctx.fillStyle = '#3b2a7a'; ctx.fillText(label, this.VW / 2, y + 17);
    ctx.restore();
    if (ck < 1 && fx.gain) {
      ctx.globalAlpha = 1 - ck; ctx.fillStyle = '#7b61d9'; ctx.font = '700 16px Fredoka, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('+' + fx.gain + '%', x + w + 8, y + 18 - ck * 10); ctx.globalAlpha = 1;
    }
  }
  /* World-space burst presentation. Every active launcher wears a rainbow ring;
     links join the launchers at activation. A trio gets a closed triangle. */
  drawPowerFx(ctx) {
    const fx = this.powerFx, team = this.teamHumans().map(i => this.players[i]); if (team.length < 2) return;
    const y = this.LAUNCH_Y - 44;
    if (this.teamPowerActive) {
      ctx.lineWidth = 5;
      for (const p of team) {
        ctx.strokeStyle = 'hsl(' + ((this.now * 200) % 360) + ',85%,62%)';
        ctx.beginPath(); ctx.arc(p.x, y, 41 + Math.sin(this.now * 8) * 3, 0, 7); ctx.stroke();
      }
    }
    const k = fx && fx.actT !== undefined ? (this.now - fx.actT) / 1.4 : 9;
    if (k < 0 || k >= 1) return;
    const reach = Math.min(1, k * 3), n = 24;
    ctx.globalAlpha = 1 - k; ctx.lineWidth = 9 * (1 - k * 0.5); ctx.lineCap = 'round';
    const edges = team.length === 3 ? [[0,1],[1,2],[2,0]] : team.slice(1).map((_, i) => [i, i + 1]);
    for (const [start, end] of edges) {
      const a = team[start], b = team[end], lift = 120 + Math.abs(b.x - a.x) * 0.15;
      for (let i = 0; i < n * reach; i++) {
        const at = v => ({ x: a.x + (b.x - a.x) * v, y: y - Math.sin(v * Math.PI) * lift });
        const p0 = at(i / n), p1 = at(Math.min(1, (i + 1) / n));
        ctx.strokeStyle = 'hsl(' + ((i * 15 + this.now * 240) % 360) + ',90%,62%)';
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
    }
    ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
  }
  // Screen-space: a soft team glow, breathing while a power runs.
  drawPowerGlow(ctx) {
    const fx = this.powerFx || {}, flash = fx.actT !== undefined ? clamp(1 - (this.now - fx.actT) / 0.6, 0, 1) : 0;
    const a = 0.08 + 0.05 * Math.sin(this.now * 5) + flash * 0.14;
    const col = META[Math.sin(this.now * 2.5) > 0 ? 0 : 1].accent;
    const g = ctx.createRadialGradient(this.VW / 2, this.H / 2, this.H * 0.32, this.VW / 2, this.H / 2, this.H * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, col);
    ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = g; ctx.fillRect(0, 0, this.VW, this.H); ctx.globalAlpha = 1;
  }
  centerOf(keys) {
    let sx = 0, sy = 0, n = 0;
    keys.forEach(k => { const [r,c] = k.split(',').map(Number); sx += this.cellX(r,c); sy += this.cellY(r); n++; });
    return n ? { x: sx/n, y: sy/n } : { x: this.VW/2, y: 300 };
  }
  /* Puzzle Bobble ceiling descent: the whole pack slides down one row and the
     wall stagger alternates. Bumping r and parityFlip together leaves par(r) —
     and therefore cellX — invariant, so nothing drifts sideways. Dropping
     gridTop by ROWH in the same instant cancels the jump, and the existing
     gridTop -> gridTopTarget easing plays the slide out over ~0.6s. */
  descendRow() {
    const ng = new Map();
    this.grid.forEach(b => { b.r += 1; ng.set(key(b.r,b.c), b); });
    if (this.settings.mode === 'clear') CoopObjects.shift(this.objects,1);
    this.grid = ng; this.parityFlip ^= 1;
    this.anchorRow += 1; this.gridTop -= ROWH;
    this.updateLowest(); this.refreshQueues();
  }
  shotsPerDrop() { // shots between drops, tightening as colours leave the field
    // Online the authority's own count is on the wire: the whole room for a shared board,
    // each summary for a battle board.
    if (this.online) return (this._boundBoard ? this._boundBoard.perDrop : this.onlinePerDrop) || 0;
    return dropPace(this.levelDrop(), this.settings.pressureShots, this.levelColors || 0, this.availKinds().length, this.battle ? 1 : this.players.filter(p => !p.bot && p.connected !== false).length);
  }
  missLimit() { return this.online ? (this.onlineMissLimit || this.settings.missMax)
    : Math.round(this.settings.missMax * (1 + 0.25 * Math.max(0, (this.battle ? 1 : this.players.filter(p => !p.bot && p.connected !== false).length) - 2))); }
  // The shots-before-drop warning: the pack shakes (see packJitter) and each shot ticks.
  dropWarning() {
    const left = this.dropCountdown();
    return left !== null && left > 0 && left <= PACE.warnShots && !powerHolds(this.teamPowerActive, 'holdPressure');
  }
  dropWarnSfx() { if (this.dropWarning()) this.sfx('dropTick'); }
  packJitter() {
    if (!this.dropWarning() || (this.state !== 'play' && this.state !== 'paused')) return null;
    const amp = this.dropCountdown() <= 1 ? 2.6 : 1.4;
    return { x: Math.sin(this.now * 47) * amp, y: Math.cos(this.now * 39) * amp * 0.5 };
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
    this.beginOutro(() => this.showEnd(won));
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
  /* The frame pipeline (see frame-pipeline above): read input, step the simulation, render
     the state that input produced, and only then touch the DOM. */
  frame(t) {
    this._raf = requestAnimationFrame(tt => this.frame(tt));
    const perf = this._perf, t0 = perf ? performance.now() : 0;
    const dt = Math.max(0, (t - (this._t || t)) / 1000); this._t = t;
    this.pollGamepads();
    const { n, h } = simSteps(dt, this.simHz || FRAME.simHz);
    const battle = !!(this.battle && this.settings.mode === 'battle');
    for (let s = 0; s < n; s++) {
      if (battle) {
        if (!this.online && this.state === 'play') this.battleUpdate(h);
        else if (this.online && ['play','paused','spectating','won','lost'].includes(this.state)) this.updateOnlineBattleVisuals(h);
        else break;
      } else if (this.state === 'play' && !this.online) this.update(h);
      else if (!this.online && this._outro) { this.now += h; this.stepFx(h); this.fxTick(); }
      else if (this.online && ['play','paused','levelup','won','lost'].includes(this.state)) this.updateOnlineVisuals(h);
      else break;
      if (perf) perf.steps++;
    }
    this.tickOutro();
    const t1 = perf ? performance.now() : 0;
    if (battle) this.battleRender(); else this.render();
    const t2 = perf ? performance.now() : 0;
    this.syncCalibration();
    this.syncMenuFocus();
    this.syncTvHud();
    if (!battle) { this.syncPassButton(); this.syncPowerButton(); }
    if (perf) this.perfFrame(t, t0, t1, t2);
  }
  /* ---------- development diagnostics ----------
     ?perf (or F9) shows what the display is really doing: the measured rAF cadence and the
     refresh it matches, frame time, input → render (event timestamp to the end of the frame
     that drew it, so scanout is not included), simulation and render time, and the step
     rate. Off, the frame loop pays one null check. */
  perfToggle(on = !this._perf) {
    if (!on) { this._perf = null; if (this.perfEl) this.perfEl.style.display = 'none'; return; }
    this._perf = { gaps: [], steps: 0, frames: 0, sim: 0, draw: 0, work: 0, lat: [], inputAt: 0, seen: 0, last: 0, shownAt: 0 };
    if (this.perfEl) { this.perfEl.style.display = 'block'; this.perfEl.textContent = 'measuring…'; }
  }
  perfInput(ts) { if (this._perf) this._perf.inputAt = Math.max(this._perf.inputAt, ts || performance.now()); }
  perfFrame(t, t0, t1, t2) {
    const P = this._perf, end = performance.now();
    if (P.last) { P.gaps.push(t - P.last); if (P.gaps.length > 120) P.gaps.shift(); }
    P.last = t; P.frames++; P.sim += t1 - t0; P.draw += t2 - t1; P.work += end - t0;
    if (P.inputAt > P.seen) { P.lat.push(end - P.inputAt); P.seen = P.inputAt; if (P.lat.length > 30) P.lat.shift(); }
    const span = (t - (P.shownAt || t)) / 1000;
    if (!P.shownAt) P.shownAt = t;
    if (span < FRAME.perfSample || !this.perfEl) return;
    const { fps, hz } = cadence(P.gaps), f = P.frames || 1, ms = x => x.toFixed(2) + ' ms';
    const lat = P.lat.length ? P.lat.reduce((a, b) => a + b, 0) / P.lat.length : null;
    this.perfEl.textContent = [
      `present ${fps.toFixed(1)} fps · ~${hz} Hz`,
      `frame   ${fps ? ms(1000 / fps) : '–'} (work ${ms(P.work / f)})`,
      `input→render ${lat === null ? '–' : ms(lat)}`,
      `sim     ${ms(P.sim / f)} · ${Math.round(P.steps / span)} steps/s (≤${this.simHz || FRAME.simHz} Hz)`,
      `render  ${ms(P.draw / f)}`,
    ].join('\n');
    Object.assign(P, { frames: 0, steps: 0, sim: 0, draw: 0, work: 0, shownAt: t });
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
    if (p.serverAngle === undefined || p.held.l || p.held.r || p.held.analog || p.aimTarget != null) return;
    const gap = p.serverAngle - p.angle;
    if (Math.abs(gap) > 0.35) p.angle = p.serverAngle;
    else p.angle = clamp(p.angle + clamp(gap, -3 * dt, 3 * dt), -AIM_MAX, AIM_MAX);
  }
  // Everyone else's barrel: interpolate toward the last snapshot rather than teleporting to it.
  followServerAim(p, dt) {
    if (p.serverAngle === undefined) return;
    const gap = p.serverAngle - p.angle;
    p.angle = Math.abs(gap) > 0.6 ? p.serverAngle : p.angle + gap * Math.min(1, 14 * dt);
  }
  updateOnlineVisuals(dt) {
    // 'levelup' is a frozen board behind the scoreboard card, so it holds like a pause.
    if (this.state !== 'paused' && this.state !== 'levelup') {
      this.now += dt;
      const own=this.players[this.activeP];
      if(own)this.predictOwnAim(own,dt);
      if(this.passCd>0)this.passCd=Math.max(0,this.passCd-dt);
      if(this.teamPowerActive)this.teamPowerTimer=Math.max(0,this.teamPowerTimer-dt);
      for(const p of this.players){p.reload=Math.max(0,p.reload-dt);if(p!==own)this.followServerAim(p,dt);}
      stepOnlineFlights(this.flights,dt,X0+R,this.WW-X0-R);
      if(this.danger&&!powerHolds(this.teamPowerActive,'holdRescue'))this.danger.t=Math.max(0,this.danger.t-dt);
      const floor=92+this.LAUNCH_Y-60-R+6;
      stepOnlineFalling(this.falling,dt,floor);
      const p=this.players[this.activeP];if(p){const target=clamp(p.x+Math.sin(p.angle)*420-W/2,0,Math.max(0,this.WW-W));this.camX+=(target-this.camX)*Math.min(1,6*dt);}
    }
    this.fxTick();
  }
  updateOnlineBattleVisuals(dt) {
    const bt=this.battle;if(!bt)return;
    if(this.state!=='paused'){
      this.now+=dt;if(bt.targeting)bt.targeting.t=Math.max(0,bt.targeting.t-dt);
      for(const b of bt.boards){this.bindBoard(b);const p=b.player;
        if(b===bt.human&&this.state==='play'&&!bt.targeting)this.predictOwnAim(p,dt);else this.followServerAim(p,dt);
        p.reload=Math.max(0,(p.reload||0)-dt);stepOnlineFlights(this.flights,dt,X0+R,W-X0-R);
        stepOnlineFalling(this.falling,dt,92+this.LAUNCH_Y-60-R+6);
        if(this.danger)this.danger.t=Math.max(0,this.danger.t-dt);this.fxTick();this.unbindBoard(b);}
    }
    const want=!!bt.targeting||bt.spectate;bt.zoom=clamp(bt.zoom+(want?6:-6)*dt,0,1);
  }
  update(rdt) {
    const ts = this.danger ? 0.55 : 1; // dramatic slow-mo during rescue window
    const dt = rdt * ts;
    this.now += rdt;
    CoopObjects.tick(this,rdt);
    if (this.passCd > 0) this.passCd = Math.max(0, this.passCd - rdt); // real time, like the chain window
    if (this.teamPowerActive && (this.teamPowerTimer -= rdt) <= 0) this.endTeamPower();
    this.gridTop += clamp(this.gridTopTarget - this.gridTop, -80*rdt, 80*rdt);
    // player input streams
    for (const p of this.players) {
      p.reload = Math.max(0, p.reload - dt);
      if (p.bot) this.botUpdate(p, dt);
      else {
        if (p.held.l || p.held.r || p.held.analog || p.aimTarget != null) this.activeP = p.i;
        aimTick(p, rdt, this.settings.aimSpeed);
      }
    }
    // Hurry-up, as OnlineGame runs it: humans only, and a running power holds the clock.
    if (!powerHolds(this.teamPowerActive, 'holdPressure')) for (const p of this.players) {
      if (p.bot) continue;
      const hurry = hurryTick(p, rdt, this.settings.hurry);
      if (hurry === 'warn') this.showHurry(p.i);
      else if (hurry === 'fire' && p.reload <= 0) { this.activeP = p.i; this.fire(p.i); }
    }
    /* The camera follows the active player's aim only on the wide 4× field. A board that
       fits its view — classic, and the whole 16/15 two-player field — never moves: not for
       aim, the shooter, a shot in flight, a pop or a drop. */
    if (this.WW > this.VW) {
      const pf = this.players[this.activeP] || this.players[0];
      const camT = clamp(pf.x + Math.sin(pf.angle) * 420 - this.VW / 2, 0, this.WW - this.VW);
      this.camX += (camT - this.camX) * Math.min(1, 6 * rdt);
    } else this.camX = 0;
    this.stepFlights(dt);
    if (this.resolveAt && this.now >= this.resolveAt) this.resolveBatch();
    const perDrop = this.shotsPerDrop();
    if (perDrop && this.pressure >= perDrop && !this.resolveAt && !powerHolds(this.teamPowerActive, 'holdPressure')) this.pressureDescend();
    this.stepFx(dt);
    this.dispScore += (this.score - this.dispScore) * Math.min(1, 10 * rdt);
    // chain timer
    if (this.chain.t > 0) { this.chain.t -= rdt; if (this.chain.t <= 0) { this.chain.mult = 1; this.chain.players.clear(); this.chain.trioAwarded = false; this.chain.last = -1; } }
    // danger / rescue (real time)
    const inDanger = this.anyDangerCells();
    if (inDanger && !this.danger) { this.danger = { t: this.settings.rescueDur, max: this.settings.rescueDur }; this.callout('DANGER! CLEAR THE LINE!', '#ff5b6b'); this.sfx('warn'); }
    else if (!inDanger && this.danger) { this.danger = null; }
    if (this.danger && !powerHolds(this.teamPowerActive, 'holdRescue')) { this.danger.t -= rdt; if (this.danger.t <= 0) return this.endGame(false); }
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
  /* Cosmetic stepping only: falling bubbles and sparks. It runs inside update() during play
     and on its own after a clear, so the last drop lands before the card covers the board. */
  stepFx(dt) {
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
  }
  /* A clear is decided at once (score, state, progress); only the card waits, until the last
     fallers have landed or OUTRO_MAX runs out. Online snapshots swap in a fresher `show`. */
  beginOutro(show) { this._outro = { show, until: this.now + OUTRO_MAX }; }
  tickOutro() {
    const o = this._outro; if (!o) return;
    if (this.now < o.until && (this.falling.length || this.pops.length)) return;
    this._outro = null; o.show();
  }
  fxTick() {
    this.pops = this.pops.filter(p => this.now - p.t < 0.62);
    this.ripples = this.ripples.filter(r => this.now - r.t < 0.45);
    this.callouts = this.callouts.filter(c => this.now - c.t < 1.5);
    this.popups = (this.popups || []).filter(p => this.now - p.t < 1.1);
    this.teamFx = (this.teamFx || []).filter(f => this.now - f.t < 1.6);
    if (this.passFx && this.now - this.passFx.t > PASS_FX * 1.8) this.passFx = null;
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
  /* Every effect is synthesised at the moment of its gameplay event (fire, bounce, attach,
     pop…), so there is nothing to fetch or decode; the only latency to remove is opening the
     context, which the first gesture of any kind does, asking for interactive latency. */
  ensureAudio() {
    if (!this._ac) { const AC = window.AudioContext || window.webkitAudioContext;
      try { this._ac = new AC({ latencyHint: 'interactive' }); } catch (e) { try { this._ac = new AC(); } catch (_) {} } }
    if (this._ac && this._ac.state === 'suspended') this._ac.resume().catch(() => {});
  }
  /* Decode every gameplay sprite, the cabinet art and the canvas font before play, so the
     first bomb, rainbow or launcher frame is not the one that hitches on decode or a font swap. */
  warmAssets() {
    for (const img of [...Object.values(BUBBLE_SPRITES), ...Object.values(LAUNCHER_SPRITES), ...Object.values(THEME_SPRITES)])
      if (img && img.decode) img.decode().catch(() => {});
    try { if (document.fonts && document.fonts.load) for (const w of [400, 500, 600, 700]) document.fonts.load(w + ' 20px Fredoka').catch(() => {}); } catch (_) {}
  }

  /* ---------- local controller join / side pick ---------- */
  beginLocalPlay(campaign = 'original') {
    this.tvFullscreenNudge(); this.online = false;
    const changed=(this.settings.campaign||'original')!==campaign;
    this.settings.campaign=campaign;
    if(changed) this.settings.level=0;
    if(campaign==='coop2') {
      this.settings.mode='clear'; this.settings.field='classic'; this.settings.players=2;
      this.settings.human=[true,true,false,false];
    }
    this.resetGame(); this._syncSettings?.(); this.homeEl.style.display = 'none';
    const duo = this.settings.mode === 'clear' && this.settings.players === 2
      && this.settings.human[0] && this.settings.human[1];
    if (duo && typeof navigator !== 'undefined' && navigator.getGamepads) this.openPadPick();
    else { this.showTutorial(); this._tutBack = 'home'; }
  }
  openPadPick() {
    this._padPickActive = true; this._padPickPending = new Map();
    this._padSlots = new Map(); this._padPrev = new Map(); this._padReservations = new Map();
    this.state = 'controller-pick'; this.padPickEl.style.display = 'grid'; this.syncPadPick();
  }
  finishPadPick(skip = false) {
    if (!this._padPickActive && !skip) return;
    this._padPickActive = false; this._padPickPending = new Map();
    if (skip) { this._padSlots = new Map(); this._padReservations = new Map(); }
    if (this.padPickEl) this.padPickEl.style.display = 'none';
    this.showTutorial(); this._tutBack = 'home';
  }
  cancelPadPick() {
    this._padPickActive = false; this._padPickPending = new Map(); this._padSlots = new Map();
    this._padReservations = new Map(); if (this.padPickEl) this.padPickEl.style.display = 'none';
    this.state = 'home'; this.homeEl.style.display = 'grid';
  }
  syncPadPick() {
    const el = this.padPickEl; if (!el) return;
    const slots = this._padSlots || new Map(), pending = this._padPickPending || new Map();
    const assigned = side => [...slots].find(([, s]) => s === side);
    const hovering = side => [...pending].find(([, s]) => s === side);
    el.querySelectorAll('.padPickSide').forEach(sideEl => {
      const side = +sideEl.dataset.player, hit = assigned(side), hot = hovering(side);
      sideEl.classList.toggle('picked', !!hit); sideEl.classList.toggle('hot', !!hot && !hit);
      const text = sideEl.querySelector('span');
      text.textContent = hit ? `Controller ${hit[0] + 1}` : hot ? `Controller ${hot[0] + 1} choosing` : 'Open';
    });
    const status = el.querySelector('.padPickStatus'), p = [...pending][0];
    if (p) status.textContent = `Controller ${p[0] + 1}: choose LEFT or RIGHT · A / Cross confirms · B cancels`;
    else if (new Set(slots.values()).size >= 2) status.textContent = 'Both players ready!';
    else if (slots.size) status.textContent = 'First player ready · press A / Cross on the second controller';
    else status.textContent = 'Press A / Cross on a controller to join';
  }
  padPickInput(g, h, hit) {
    const idx = g.index, slots = this._padSlots, pending = this._padPickPending, reservations = this._padReservations;
    if (slots.has(idx)) {
      if (hit('b')) { const side = slots.get(idx); slots.delete(idx); reservations.delete(idx); this.padToast(`Controller ${idx + 1} left ${side ? 'RIGHT' : 'LEFT'}`); this.syncPadPick(); }
      return;
    }
    if (hit('b')) { pending.delete(idx); this.syncPadPick(); return; }
    const free = () => [0, 1].filter(side => ![...slots.values()].includes(side)
      && ![...pending].some(([other, s]) => other !== idx && s === side));
    if (!pending.has(idx)) {
      if (!(hit('a') || hit('start'))) return;
      const choices = free(); if (!choices.length) return;
      if (choices.length === 1) { slots.set(idx, choices[0]); reservations.set(idx, choices[0]); this.padToast(`Controller ${idx + 1} · ${choices[0] ? 'RIGHT' : 'LEFT'}`); }
      else pending.set(idx, h > 0 ? 1 : 0);
      this.syncPadPick(); return;
    }
    if (h) { const want = h > 0 ? 1 : 0; if (free().includes(want)) pending.set(idx, want); }
    if (hit('a') || hit('start')) {
      const side = pending.get(idx); if (free().includes(side)) { pending.delete(idx); slots.set(idx, side); reservations.set(idx, side); this.padToast(`Controller ${idx + 1} · ${side ? 'RIGHT' : 'LEFT'}`); }
    }
    this.syncPadPick();
  }

  /* ---------- gamepads ----------
     Pad n drives the nth human launcher, the same stream a key pair would; online it is this
     device's launcher. Held directions are written only when the stick changes, so a pad
     and a keyboard can share a player without the pad stomping the keys every frame. */
  calibrationOpen() {
    return !!(this.calibrationEl?.open && this.sideEl?.classList.contains('open'));
  }
  stickProfile(g) {
    const profiles = this._stickProfiles || (this._stickProfiles = new Map());
    let p = profiles.get(g.index);
    if (p && p.id === g.id) return p;
    const base = JSON.stringify([g.id || '', g.mapping || '', g.axes.length, g.buttons.length]);
    const used = new Set([...profiles.values()].filter(p => p.base === base).map(p => p.ordinal));
    let ordinal = 0; while (used.has(ordinal)) ordinal++;
    const key = 'bt_stick_v1:' + base + ':' + ordinal;
    let dead = STICK_DEFAULT;
    try { const saved = g.id ? JSON.parse(localStorage.getItem(key)) : null;
      if (typeof saved === 'number' && Number.isFinite(saved) && saved >= 0.02 && saved <= 0.5) dead = saved;
    } catch (_) {}
    p = { id:g.id, base, ordinal, key, dead, x:0, y:0, result:'' };
    profiles.set(g.index, p); return p;
  }
  saveStick(p, value) {
    p.dead = clamp(value, 0.02, 0.5); p.rest = null;
    try { if (p.id) localStorage.setItem(p.key, JSON.stringify(p.dead)); } catch (_) {}
  }
  sampleSticks(pads, now) {
    const profiles = this._stickProfiles || (this._stickProfiles = new Map());
    for (const index of profiles.keys()) if (!pads.some(g => g.index === index)) profiles.delete(index);
    for (const g of pads) {
      const p = this.stickProfile(g);
      p.x = stickValue(g.axes[0]); p.y = stickValue(g.axes[1]);
      const magnitude = Math.hypot(p.x, p.y);
      if (p.sample) {
        if (!this.calibrationOpen() || document.hidden) { p.sample = null; p.result = 'Calibration cancelled. Keep this screen visible.'; }
        else {
          const sample = p.sample;
          // Give the activating button a second to release before measuring rest.
          if (now >= sample.start) {
            if (now - sample.last > 300 && sample.count) sample.invalid = true;
            sample.last = now; sample.count++; sample.max = Math.max(sample.max, magnitude);
            if (g.buttons.some(b => b.pressed)) sample.invalid = true;
          }
          if (now >= sample.start + 2500) {
            p.sample = null;
            if (sample.invalid || sample.count < 20 || sample.max > 0.45) p.result = 'Movement or interrupted sampling detected. Release the stick and retry.';
            else { const before = p.dead, next = stickRecommendation(sample.max); this.saveStick(p, next);
              p.result = `Observed ${(sample.max*100).toFixed(1)}% drift. Applied ${Math.round(before*100)}% → ${Math.round(next*100)}%. Adjust below if needed.`;
            }
          }
        }
      }
      // Optional suggestion only: stable, small displacement with no buttons for 2.5s.
      // Movement cannot reliably be classified as drift by the browser, so never apply it.
      if (this.state === 'levelup' && !this.calibrationOpen() && !g.buttons.some(b => b.pressed) && magnitude > p.dead + 0.03 && magnitude < 0.25) {
        if (!p.rest || Math.hypot(p.x-p.rest.x,p.y-p.rest.y) > 0.01) p.rest = { x:p.x,y:p.y,start:now };
        else if (now-p.rest.start > 2500 && !p.warned) { p.warned = true; this.padToast('Possible controller drift — recalibrate in Settings → Controller Calibration?'); }
      } else p.rest = null;
    }
  }
  syncCalibration() {
    if (!this.calibrationOpen()) return;
    const host = this.calibrationEl.querySelector('.stickCards');
    const profiles = this._stickProfiles || new Map();
    const signature = JSON.stringify([...profiles].map(([i,p]) => [i,p.key,this._padSlots?.get(i)]));
    if (host.dataset.signature !== signature) {
      host.dataset.signature = signature;
      host.innerHTML = profiles.size ? [...profiles].map(([i,p]) => {
        const slot = this._padSlots?.get(i);
        return `<section data-stick="${i}"><h3>${slot === undefined ? 'Unassigned' : 'Player ' + (slot+1)} · Controller ${i+1}</h3>
        <p>${this.escapeHTML(p.id || 'Unknown controller')}</p>
        <svg viewBox="-110 -110 220 220" width="180" height="180" role="img" aria-label="Live aiming stick and deadzone" style="display:block;max-width:100%">
        <circle r="100" fill="#edf5ff" stroke="#53759c"/><path d="M-100 0H100M0-100V100" stroke="#adc3dc"/>
        <circle class="stickZone" fill="#a8d9b7" fill-opacity=".6" stroke="#33814d"/><circle class="stickDot" r="5"/></svg>
        <output class="stickReading"></output><label style="display:block">Deadzone <output class="stickPercent"></output>
        <input aria-label="Controller ${i+1} deadzone" class="stickRange" type="range" min="2" max="50" step="1" style="width:100%"></label>
        <button class="btn ghost stickAuto">Auto Calibrate</button><p class="stickResult" role="status"></p></section>`;
      }).join('') : '<p>No controllers detected. Connect a controller and press a button.</p>';
      host.querySelectorAll('[data-stick]').forEach(card => {
        const p = profiles.get(+card.dataset.stick), slider = card.querySelector('input');
        slider.value = Math.round(p.dead*100);
        slider.oninput = () => { p.sample = null; this.saveStick(p, Number(slider.value)/100); p.result = 'Manual deadzone saved.'; this.syncCalibration(); };
        card.querySelector('button').onclick = () => { p.sample = {start:performance.now()+1000,last:0,count:0,max:0}; p.result = ''; };
      });
    }
    host.querySelectorAll('[data-stick]').forEach(card => {
      const p = profiles.get(+card.dataset.stick), magnitude = Math.hypot(p.x,p.y);
      const status = Math.abs(magnitude-p.dead) <= 0.01 ? 'Touching edge' : magnitude < p.dead ? 'Safely inside' : 'Outside — may cause drift';
      card.querySelector('.stickZone').setAttribute('r',p.dead*100);
      const dot = card.querySelector('.stickDot'); dot.setAttribute('cx',p.x*100); dot.setAttribute('cy',p.y*100);
      dot.setAttribute('fill',status === 'Safely inside' ? '#237b43' : status === 'Touching edge' ? '#986500' : '#c33232');
      card.querySelector('.stickReading').textContent = `X ${p.x.toFixed(3)} · Y ${p.y.toFixed(3)} · ${(magnitude*100).toFixed(1)}% · ${status}`;
      card.querySelector('.stickPercent').textContent = Math.round(p.dead*100)+'%';
      card.querySelector('input').value = Math.round(p.dead*100);
      card.querySelector('button').disabled = !!p.sample;
      card.querySelector('.stickResult').textContent = p.sample ? `Leave the stick untouched… ${Math.max(0,(p.sample.start+2500-performance.now())/1000).toFixed(1)}s` : p.result;
    });
  }
  connectedPads() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    try { return [...navigator.getGamepads()].filter(g => g && g.connected); } catch (_) { return []; }
  }
  padOwner(i) { return (this._padPlayers || []).includes(i); }
  /* Pads keep a slot from connect to disconnect (lowest free slot first), so slot n drives the
     nth human no matter which other pad drops out, and a pad that reconnects usually lands
     back on its own launcher. A new pad's already-held buttons are not presses. */
  pollGamepads() {
    const pads = this.connectedPads(), slots = this._padSlots || (this._padSlots = new Map());
    const prev = this._padPrev || (this._padPrev = new Map()), reservations = this._padReservations || (this._padReservations = new Map());
    const pending = this._padPickPending || (this._padPickPending = new Map()), live = new Set(pads.map(g => g.index));
    const humans = this._padHumans = (this.players || []).filter(p => !p.bot).map(p => p.i);
    let changed = false;
    for (const idx of [...prev.keys()]) if (!live.has(idx)) {
      const slot = slots.get(idx);
      if (slot !== undefined) { slots.delete(idx); if (this._padPickActive) reservations.delete(idx); this.padLost(slot, idx); }
      pending.delete(idx); prev.delete(idx); changed = true;
    }
    for (const g of pads) if (!prev.has(g.index)) {
      // In the side picker the wake-up A/Cross press is the join press. During play we still
      // swallow buttons already held at connect time so reconnecting cannot fire a shot.
      prev.set(g.index, { b: this._padPickActive ? g.buttons.map(() => false) : g.buttons.map(x => !!(x && x.pressed)), h: 0, nav: '', navT: 0 });
      changed = true;
      if (this._padPickActive) this.padToast(`Controller ${g.index + 1} connected · press A / Cross to join`);
      else {
        const used = new Set(slots.values());
        const blocked = new Set([...reservations].filter(([other]) => other !== g.index && !live.has(other)).map(([, slot]) => slot));
        let slot = reservations.get(g.index);
        if (slot === undefined || used.has(slot)) { slot = 0; while (used.has(slot) || blocked.has(slot)) slot++; reservations.set(g.index, slot); }
        slots.set(g.index, slot); this.padFound(slot, g.index);
      }
    }
    if (changed) {
      this._padCount = pads.length;
      if (this.settings.displayMode === 'auto') this.measure(); // a controller can make this the TV
      if (this._padPickActive) this.syncPadPick();
    }
    this._padPlayers = [...slots.values()].map(n => humans[n]).filter(i => i !== undefined);
    this.sampleSticks(pads, performance.now());
    if (!pads.length) return;
    const menu = this._padPickActive ? null : this.menuRoot();
    pads.forEach(g => {
      const n = slots.get(g.index), was = prev.get(g.index) || { b: [], h: 0, nav: '', navT: 0 };
      const b = g.buttons.map(x => !!(x && x.pressed));
      const down = k => b[GAMEPAD.btn[k]], hit = k => down(k) && !was.b[GAMEPAD.btn[k]];
      const ax = stickValue(g.axes[0]), ay = stickValue(g.axes[1]);
      const digital = down('left') ? -1 : down('right') ? 1 : 0;
      const analog = digital ? 0 : stickAnalog(ax, ay, this.stickProfile(g).dead);
      const navigatingCalibration = this.calibrationOpen();
      const h = down('left') || (!navigatingCalibration && ax < -GAMEPAD.dead) ? -1 : down('right') || (!navigatingCalibration && ax > GAMEPAD.dead) ? 1 : 0;
      const v = down('up') || (!navigatingCalibration && ay < -GAMEPAD.dead) ? -1 : down('down') || (!navigatingCalibration && ay > GAMEPAD.dead) ? 1 : 0;
      const now = performance.now() / 1000;
      if (this._perf && (h !== was.h || analog !== (was.analog || 0) || b.some((x, k) => x !== !!was.b[k]))) this.perfInput(g.timestamp || now * 1000);
      let nav = was.nav, navT = was.navT;
      if (this._padPickActive) this.padPickInput(g, h, hit);
      else if (hit('start')) this.padStart();
      else if (hit('back')) this.toggleSide();
      else if (menu) {
        const dir = v ? 'v' + v : h ? 'h' + h : '';
        if (dir && (dir !== was.nav || now >= was.navT)) {
          this.menuMove(menu, dir[0], +dir.slice(1));
          navT = now + (dir !== was.nav ? GAMEPAD.repeatFirst : GAMEPAD.repeat);
        }
        nav = dir;
        if (menu === this.screenFitEl) {
          if (hit('x')) this.cycleFitEdge(1);
          if (hit('y')) this.resetScreenFit();
          if (hit('lb')) this.stepScreenFit(-1);
          if (hit('rb')) this.stepScreenFit(1);
        }
        if (hit('a')) this.menuActivate(menu);
        if (hit('b')) this.menuBack();
      } else if (n !== undefined) this.padPlay(n, digital, digital !== (was.digital || 0), hit, analog, h, h !== was.h);
      prev.set(g.index, { b, h, digital, analog, nav, navT });
    });
    if (this._padPickActive && new Set(slots.values()).size >= 2) this.finishPadPick(false);
  }
  // The human a pad slot drives; undefined once there are more pads than humans.
  padHuman(n) { return (this._padHumans || [])[n]; }
  /* A dropped controller must not leave its launcher turning forever or a match running with
     nobody at the stick: its holds are released and local play pauses until it is back. */
  padLost(slot, padIndex = slot) {
    const i = this.padHuman(slot);
    this.padToast(`Controller ${padIndex + 1} disconnected`);
    if (i === undefined) return;
    const bt = this.battle && this.settings.mode === 'battle' ? this.battle : null;
    const p = bt ? (slot ? null : bt.human && bt.human.player) : (this.players || [])[i];
    if (p) { p.held = { l: false, r: false }; p.aimTarget = null; }
    if (this.online && !slot) { this.setOnlineAnalog(0); this.setOnlineHeld('l', false); this.setOnlineHeld('r', false); }
    if (!this.online && this.state === 'play') {
      this.togglePause();
      const sub = this.shadowRoot.querySelector('.pauseSub');
      if (sub) sub.textContent = `Controller ${padIndex + 1} disconnected — reconnect it, then press A or Start to resume`;
    }
  }
  padFound(slot, padIndex = slot) {
    const i = this.padHuman(slot), p = i === undefined ? null : (this.players || [])[i];
    this.padToast(`Controller ${padIndex + 1} connected` + (p ? ' · ' + (p.name || (p.meta || META[i]).name) : ''));
  }
  padToast(text) {
    const el = this.toastEl; if (!el) return;
    el.textContent = text; el.classList.add('on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('on'), 3200);
  }
  padPlay(n, h, turned, hit, analog = 0, navH = h, navTurned = turned) {
    const applyAnalog = p => {
      if ((p.held.analog || 0) !== analog) { p.held.analog = analog; p.aimTarget = null; }
    };
    if (this.online && !n) this.setOnlineAnalog(analog);
    const fire = hit('a') || hit('rt'), passLeft = hit('lb'), passRight = hit('rb') || hit('x'), power = hit('y');
    if (this.battle && this.settings.mode === 'battle') {
      if (n) return;
      const bt = this.battle, tg = bt.targeting;
      // Picking a rival: left / right walks the living boards, A dumps the junk.
      if (tg && bt.human && tg.by === bt.human.i) {
        const alive = bt.boards.filter(x => x.alive && x.i !== tg.by);
        if (navTurned && navH && alive.length) {
          const at = alive.findIndex(x => x.i === tg.hover);
          tg.hover = alive[(at + navH + alive.length) % alive.length].i;
        }
        if (fire) this.chooseBattleTarget(bt.boards[tg.hover] || alive[0]);
        return;
      }
      if (this.online) { if (turned) { this.setOnlineHeld('l', h < 0); this.setOnlineHeld('r', h > 0); } if (fire) this.fire(); return; }
      const hp = bt.human && bt.human.player; if (!hp) return;
      applyAnalog(hp);
      if (turned) { hp.held.l = h < 0; hp.held.r = h > 0; hp.aimTarget = null; }
      if (fire) this.battleFire();
      return;
    }
    if (this.online) {
      if (n) return;
      if (turned) { this.setOnlineHeld('l', h < 0); this.setOnlineHeld('r', h > 0); }
      if (hit('b')) this.requestBombToggle(this.activeP);
      if (fire) this.fire();
      if (passLeft || passRight) this.requestPass(this.activeP, passLeft ? -1 : 1);
      if (power) this.requestTeamPower(this.activeP);
      return;
    }
    const i = this.padHuman(n), p = this.players[i]; if (!p || p.bot) return;
    applyAnalog(p);
    if (turned) { p.held.l = h < 0; p.held.r = h > 0; p.aimTarget = null; }
    if (hit('b')) this.requestBombToggle(i);
    if (fire) { this.activeP = i; this.fire(i); }
    if (passLeft || passRight) this.requestPass(i, passLeft ? -1 : 1);
    if (power) this.requestTeamPower(i);
  }
  padStart() {
    if (this.tvActive && this.rootEl?.classList.contains('tvTooSmall')) return;
    if (this.screenFitEl && this.screenFitEl.style.display !== 'none') { this.closeScreenFit(true); return; }
    if (this.sideEl.classList.contains('open')) { this.closeSide(); return; }
    if (this.state === 'play' || this.state === 'paused') { this.togglePause(); return; }
    const menu = this.menuRoot(); if (menu) this.menuActivate(menu);
  }
  toggleSide() { if (this.sideEl.classList.contains('open')) this.closeSide(); else this.sideEl.classList.add('open'); }
  /* The surface a controller is navigating: Screen Fit or the settings drawer if open,
     otherwise the top-most visible card. Null during active play. */
  menuRoot() {
    if (this.tvActive && this.rootEl?.classList.contains('tvTooSmall') && this.tvSmallEl) return this.tvSmallEl;
    if (this.screenFitEl && this.screenFitEl.style.display !== 'none') return this.screenFitEl;
    if (this.sideEl && this.sideEl.classList.contains('open') && this.sideEl.offsetParent !== null) return this.sideEl;
    const cards = [this.homeEl, this.lobbyEl, this.reconnectEl, this.tutEl, this.pauseEl, this.levelUpEl, this.endEl];
    for (let k = cards.length - 1; k >= 0; k--) {
      const el = cards[k]; if (el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none') return el;
    }
    return null;
  }
  menuFocusables(root) {
    return [...root.querySelectorAll('button,select,input,textarea,summary')]
      .filter(el => !el.disabled && !el.hidden && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }
  // Each screen's opening selection: its marked couch default, else its primary action.
  menuDefault(root, list = this.menuFocusables(root)) {
    return list.find(el => el.hasAttribute('data-tv-default')) || list.find(el => el.classList.contains('sfRange'))
      || list.find(el => el.classList.contains('primary')) || list[0] || null;
  }
  menuFocus(el) { if (!el) return; el.focus({ preventScroll: true }); el.scrollIntoView?.({ block: 'nearest' }); }
  menuMove(root, axis, d) {
    const list = this.menuFocusables(root); if (!list.length) return;
    const cur = this.shadowRoot.activeElement, at = list.indexOf(cur);
    if (at < 0) { this.menuFocus(this.menuDefault(root, list)); return; }
    // Arcade entry for short codes (room code, initials): up / down picks the character.
    if (cur.dataset.padChars && this.padCharInput(cur, axis, d)) return;
    // Left / right adjusts a picker or slider in place; up / down moves between controls.
    if (axis === 'h' && cur.tagName === 'SELECT') {
      cur.selectedIndex = clamp(cur.selectedIndex + d, 0, cur.options.length - 1);
      cur.dispatchEvent(new Event('change', { bubbles: true })); return;
    }
    if (axis === 'h' && cur.type === 'range') {
      d > 0 ? cur.stepUp() : cur.stepDown();
      cur.dispatchEvent(new Event('input', { bubbles: true })); cur.dispatchEvent(new Event('change', { bubbles: true })); return;
    }
    this.menuSpatial(list, at, axis, d);
  }
  menuSpatial(list, at, axis, d) {
    const rects = list.map(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const next = spatialPick(rects, at, axis === 'h' ? d : 0, axis === 'v' ? d : 0);
    if (next >= 0) this.menuFocus(list[next]);
    return next >= 0;
  }
  /* Up / down cycles the last character through data-pad-chars, right adds one, left deletes
     one. Past either end it hands back to spatial focus so the field is never a trap. */
  padCharInput(el, axis, d) {
    const chars = el.dataset.padChars, max = el.maxLength > 0 ? el.maxLength : 3, v = el.value.toUpperCase();
    let out = v;
    if (axis === 'v') {
      if (!v) out = chars[d > 0 ? 0 : chars.length - 1];
      else { const k = chars.indexOf(v.slice(-1)); out = v.slice(0, -1) + chars[((k < 0 ? 0 : k + d) + chars.length) % chars.length]; }
    } else if (d > 0) { if (v.length >= max || !v) return false; out = v + chars[0]; }
    else { if (!v) return false; out = v.slice(0, -1); }
    el.value = out; el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  menuActivate(root) {
    const cur = this.shadowRoot.activeElement;
    if (!cur || !root.contains(cur)) { this.menuFocus(this.menuDefault(root)); return; }
    if (cur.classList.contains('sfRange')) { this.closeScreenFit(true); return; }
    if (cur.tagName === 'SELECT') { cur.selectedIndex = (cur.selectedIndex + 1) % cur.options.length; cur.dispatchEvent(new Event('change', { bubbles: true })); return; }
    // A on a text field is "done": on to the control after it (Save beside the initials).
    if (cur.tagName === 'INPUT' && cur.type !== 'range' || cur.tagName === 'TEXTAREA') {
      const list = this.menuFocusables(root), at = list.indexOf(cur);
      if (!(cur.dataset.padChars && this.menuSpatial(list, at, 'h', 1))) this.menuSpatial(list, at, 'v', 1);
      return;
    }
    cur.click();
  }
  /* B / Escape always means "back one step", and says so in the prompt bar: cancel Screen Fit,
     close the drawer, resume from pause, leave the tutorial the way you came. Where backing
     out would abandon a room it only moves focus to Leave, so it takes a second press. */
  menuBackLabel(menu = this.menuRoot()) {
    if (!menu) return null;
    if (menu === this.tvSmallEl) return null;
    if (menu === this.screenFitEl) return 'Cancel';
    if (menu === this.sideEl) return 'Close';
    if (menu === this.pauseEl) return 'Resume';
    if (menu === this.tutEl) return this._tutBack === 'home' ? 'Back' : 'Play';
    if (menu === this.lobbyEl || menu === this.reconnectEl) return 'Leave…';
    return null;
  }
  menuBack() {
    const menu = this.menuRoot();
    if (menu === this.tvSmallEl) return;
    if (menu === this.screenFitEl) { this.closeScreenFit(false); return; }
    if (menu === this.sideEl) { this.closeSide(); return; }
    if (menu === this.pauseEl) { if (this.state === 'paused') this.togglePause(); return; }
    if (menu === this.tutEl) {
      if (this._tutBack === 'home' && !this.online) { this.tutEl.style.display = 'none'; this.homeEl.style.display = 'grid'; this.state = 'home'; }
      else this.shadowRoot.querySelector('.start').click();
      return;
    }
    if (menu === this.lobbyEl) this.menuFocus(this.shadowRoot.querySelector('.lobbyLeave'));
    if (menu === this.reconnectEl) this.menuFocus(this.shadowRoot.querySelector('.reconnectLeave'));
  }
  /* Per frame while a controller could be driving (TV mode or any pad): when the surface
     changes, focus lands on its default — or on whatever was focused there last, so closing
     the drawer puts you back where you were — and the prompt bar follows the focus. */
  syncMenuFocus() {
    const on = TV.controllerNavigation && (this.tvActive || this._padCount > 0);
    const menu = on ? this.menuRoot() : null, sh = this.shadowRoot, cur = sh && sh.activeElement;
    const mem = this._menuMem || (this._menuMem = new WeakMap());
    if (this._menuPrev && cur && this._menuPrev.contains(cur)) mem.set(this._menuPrev, cur);
    if (menu !== this._menuPrev) {
      this._menuPrev = menu;
      if (menu && !(cur && menu.contains(cur))) {
        const list = this.menuFocusables(menu), back = mem.get(menu);
        this.menuFocus(back && list.includes(back) ? back : this.menuDefault(menu, list));
      }
    }
    this.syncTvPrompts(menu);
  }
  // The controller legend along the bottom of the safe area: letters, not just colours.
  syncTvPrompts(menu) {
    const el = this.promptsEl; if (!el) return;
    const show = !!(this.tvActive && menu);
    let html = '';
    if (show) {
      const cur = this.shadowRoot.activeElement, key = (k, t) => `<span><b class="tvKey k${k}">${k}</b>${t}</span>`;
      const back = this.menuBackLabel(menu), parts = [];
      if (menu === this.screenFitEl) parts.push('<span>◀▶ Move edge</span>', key('X', 'Next edge'), key('Y', 'Reset'), key('A', 'Save'));
      else if (cur && cur.dataset && cur.dataset.padChars) parts.push('<span>▲▼ Character · ▶ Add · ◀ Delete</span>', key('A', 'Done'));
      else if (cur && (cur.type === 'range' || cur.tagName === 'SELECT')) parts.push('<span>◀▶ Adjust · ▲▼ Move</span>', key('A', 'Next'));
      else parts.push('<span>✚ Move</span>', key('A', 'Select'));
      if (back) parts.push(key('B', back));
      html = parts.join('');
    }
    if (el.hidden !== !show) el.hidden = !show;
    if (this._promptsHtml !== html) { this._promptsHtml = html; el.innerHTML = html; }
  }

  /* ---------- Screen Fit (TV overscan calibration) ----------
     A draft copy of settings.screenFit is edited live — the HUD, corner buttons and menus
     follow it through relayoutTv, and the corner marks sit exactly on the calibrated safe
     edges — then Save persists it with the device prefs and Cancel / B puts the old one back. */
  bindScreenFit() {
    const el = this.screenFitEl; if (!el) return;
    el.querySelectorAll('.sfEdges button').forEach(b => { b.onclick = () => { this._fitEdge = b.dataset.e; this.syncScreenFit(); }; });
    el.querySelectorAll('.sfStep').forEach(b => { b.onclick = () => this.stepScreenFit(+b.dataset.d); });
    const range = el.querySelector('.sfRange');
    Object.assign(range, { min: TV.fit.min * 100, max: TV.fit.max * 100, step: TV.fit.step * 100 });
    range.oninput = () => this.setScreenFit(parseFloat(range.value) / 100);
    el.querySelector('.sfReset').onclick = () => this.resetScreenFit();
    el.querySelector('.sfCancel').onclick = () => this.closeScreenFit(false);
    el.querySelector('.sfSave').onclick = () => this.closeScreenFit(true);
  }
  openScreenFit() {
    if (!this.tvActive || !this.screenFitEl) return;
    this._fitReturn = this.shadowRoot.activeElement;
    this._fitDraft = normalizeScreenFit(this.settings.screenFit);
    this._fitEdge = 'all';
    if (!this.online && this.state === 'play') this.togglePause();
    this.closeSide();
    this.screenFitEl.style.display = 'grid';
    this.syncScreenFit(); this.relayoutTv();
    this.menuFocus(this.screenFitEl.querySelector('.sfRange'));
  }
  closeScreenFit(save) {
    const el = this.screenFitEl; if (!el || el.style.display === 'none') return;
    if (save && this._fitDraft) { this.settings.screenFit = normalizeScreenFit(this._fitDraft); this.saveLocalPrefs(); }
    this._fitDraft = null; el.style.display = 'none';
    if (this.tvActive) this.relayoutTv();
    const back = this._fitReturn; this._fitReturn = null;
    if (back && back.isConnected && back.getClientRects().length) this.menuFocus(back);
  }
  fitEdgeValue() { const d = this._fitDraft || this.screenFitNow(), e = this._fitEdge || 'all'; return e === 'all' ? Math.max(...FIT_EDGES.map(k => d[k])) : d[e]; }
  setScreenFit(v) {
    if (!this._fitDraft) return;
    const e = this._fitEdge || 'all', next = { ...this._fitDraft };
    for (const k of e === 'all' ? FIT_EDGES : [e]) next[k] = v;
    this._fitDraft = normalizeScreenFit(next);
    this.syncScreenFit();
  }
  stepScreenFit(d) { this.setScreenFit(this.fitEdgeValue() + d * TV.fit.step); }
  cycleFitEdge(d) {
    const order = ['all', ...FIT_EDGES], at = order.indexOf(this._fitEdge || 'all');
    this._fitEdge = order[(at + d + order.length) % order.length]; this.syncScreenFit();
  }
  resetScreenFit() { if (!this._fitDraft) return; this._fitDraft = normalizeScreenFit(TV.screenFit); this._fitEdge = 'all'; this.syncScreenFit(); }
  syncScreenFit() {
    const el = this.screenFitEl, d = this._fitDraft; if (!el || !d) return;
    const e = this._fitEdge || 'all', pct = v => (v * 100).toFixed(1) + '%', v = this.fitEdgeValue();
    el.dataset.edge = e;
    el.querySelectorAll('.sfEdges button').forEach(b => b.classList.toggle('on', b.dataset.e === e));
    el.querySelectorAll('.sfEdge').forEach(s => {
      const k = s.dataset.e, sel = e === 'all' || e === k;
      s.textContent = (sel ? '▶ ' : '') + k.toUpperCase() + ' ' + pct(d[k]);
      s.classList.toggle('sel', sel);
    });
    const range = el.querySelector('.sfRange');
    range.value = String(+(v * 100).toFixed(2));
    el.querySelector('.sfValue').textContent = (e === 'all' ? 'All edges' : e[0].toUpperCase() + e.slice(1) + ' edge') + ' inset ' + pct(v)
      + (FIT_EDGES.every(k => Math.abs(d[k] - TV.screenFit[k]) < 1e-9) ? ' · default' : '');
  }

  /* ---------- input ---------- */
  canvasPoint(e) { const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * this.VW / Math.max(1, r.width), y: (e.clientY - r.top) * this.H / Math.max(1, r.height) }; }
  /* Which pad control a touch belongs to. Exact hits resolve first, then near misses, and
     FIRE outranks everything in both passes: it is the button being reached for on nearly
     every touch, and the aim surfaces underneath it are transparent full-height overlays
     that would otherwise turn the launcher instead of shooting. */
  padHit(x, y) {
    const slop = this.padSlop();
    if (this.padBoxHit('.padF', x, y, 0)) return 'fire';
    if (slop && this.padBoxHit('.padF', x, y, slop)) return 'fire';
    if (this.padBoxHit('.padPL', x, y, 0)) return 'passLeft';
    if (this.padBoxHit('.padP', x, y, 0)) return 'pass';
    if (this.padBoxHit('.padT', x, y, 0)) return 'power';
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
     the pad buttons sit side by side and a halo would swallow its neighbours. */
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
    const passmap = { e:1, '/':2, i:3 }; // P1 passes from the pad's PASS button
    const kd = e => {
      if (/input|select|textarea/i.test(e.target.tagName)) return;
      this.ensureAudio();
      const k = e.key.toLowerCase();
      // The settings panel is a drawer over the board on narrow layouts; Escape is the way
      // out that does not require finding the gear again.
      if (k === 'escape' && this.sideEl.classList.contains('open')) { this.closeSide(); e.preventDefault(); return; }
      /* TV menus answer the keyboard the way they answer a pad: arrows move focus spatially,
         Enter presses (natively), Escape is the same "back one step" as B. */
      const menu = this.tvActive && TV.controllerNavigation ? this.menuRoot() : null;
      if (menu && e.key.startsWith('Arrow')) {
        // Fields keep their own arrows (caret, slider, picker); up / down still leaves a text box.
        const d = { arrowup: ['v', -1], arrowdown: ['v', 1], arrowleft: ['h', -1], arrowright: ['h', 1] }[k];
        const t = (e.composedPath && e.composedPath()[0]) || e.target, tag = t.tagName || '';
        if (!/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (d[0] === 'v' && tag === 'INPUT' && t.type !== 'range')) { this.menuMove(menu, d[0], d[1]); e.preventDefault(); }
        return;
      }
      if (menu && k === 'escape') { this.menuBack(); e.preventDefault(); return; }
      if (k === 'p') {
        if (this.tvActive && this.rootEl?.classList.contains('tvTooSmall')) return;
        this.togglePause();
        return;
      }
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
          return;
        }
        const hp = bt.human.player;
        if (['a','arrowleft','j'].includes(k)) { hp.held.l = true; hp.aimTarget = null; e.preventDefault(); }
        if (['d','arrowright','l'].includes(k)) { hp.held.r = true; hp.aimTarget = null; e.preventDefault(); }
        if (['w',' ','arrowup','enter','k'].includes(k)) { this.battleFire(); e.preventDefault(); }
        return;
      }
      if (this.online) {
        if (['a','arrowleft','j'].includes(k)) { this.setOnlineHeld('l', true); e.preventDefault(); }
        if (['d','arrowright','l'].includes(k)) { this.setOnlineHeld('r', true); e.preventDefault(); }
        if (['w',' ','arrowup','enter','k'].includes(k)) { this.fire(); e.preventDefault(); }
        if (k === 'e' || k === 'r') { this.requestPass(this.activeP, k === 'r' ? -1 : 1); e.preventDefault(); }
        if (k === 'b') { this.requestBombToggle(this.activeP); e.preventDefault(); }
        if (k === 'q') { this.requestTeamPower(this.activeP); e.preventDefault(); }
        return;
      }
      const am = keymap[k];
      if (am) { const p = this.players[am[0]]; if (p && !p.bot) { p.held[am[1]] = true; p.aimTarget = null; e.preventDefault(); } }
      if (firemap[k] !== undefined) { const p = this.players[firemap[k]]; if (p && !p.bot) { this.fire(firemap[k]); e.preventDefault(); } }
      if (passmap[k] !== undefined) { const p = this.players[passmap[k]]; if (p && !p.bot) { this.requestPass(p.i, e.shiftKey ? -1 : 1); e.preventDefault(); } }
      // Team Power belongs to the team, so Q is shared by both local players.
      if (k === 'b') { this.requestBombToggle(this.activeP); e.preventDefault(); }
      if (k === 'q') { const i = this.passPlayer(); if (i >= 0) { this.requestTeamPower(i); e.preventDefault(); } }
    };
    const ku = e => { const k=e.key.toLowerCase();
      if(this.battle&&this.settings.mode==='battle'&&!this.online){const hp=this.battle.human.player;if(['a','arrowleft','j'].includes(k))hp.held.l=false;if(['d','arrowright','l'].includes(k))hp.held.r=false;return;}
      if(this.online){if(['a','arrowleft','j'].includes(k))this.setOnlineHeld('l',false);if(['d','arrowright','l'].includes(k))this.setOnlineHeld('r',false);return;} const am = keymap[k];
      if (am) { const p = this.players[am[0]]; if (p) p.held[am[1]] = false; } };
    /* Capture-phase, ahead of every handler: the first gesture of any kind opens the audio
       context (so the first shot is not the one that pays for it), and the diagnostics
       overlay learns when input arrived. F9 toggles that overlay. */
    const seen = e => {
      if (e.type !== 'pointermove' && (!this._ac || this._ac.state === 'suspended')) this.ensureAudio();
      this.perfInput(e.timeStamp);
      if (e.type === 'keydown' && e.key === 'F9') { this.perfToggle(); e.preventDefault(); }
    };
    const seenOpts = { capture: true, passive: false };
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup']) window.addEventListener(type, seen, seenOpts);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this._unbind = () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      for (const type of ['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup']) window.removeEventListener(type, seen, seenOpts); };
  }
  togglePause() {
    if (this.online) {
      if (!this.onlineRoom || this.onlineRoom.hostId !== this.onlinePlayerId) return;
      this.sendOnline(this.state === 'paused' ? 'resume' : 'pause'); return;
    }
    if (this.state === 'play') { this.state = 'paused'; this.pauseEl.style.display = 'grid';
      this.shadowRoot.querySelector('.pauseSub').textContent = 'press P, Start or the button to resume'; }
    else if (this.state === 'paused') {
      if (this.tvActive && this.rootEl?.classList.contains('tvTooSmall')) return;
      this.state = 'play'; this.pauseEl.style.display = 'none'; this._t = performance.now();
    }
    this.syncButtons();
  }

  /* ---------- rendering ---------- */
  render() {
    const ctx = this.ctx; if (!ctx) return;
    // A board of another width (two players joining, a room, a battle) re-fits the view once.
    if (this._laidVW !== this.VW && this.rootEl) this.measure();
    const sc = this.canvas.width / this.VW;
    /* The canvas is see-through: the fantasy world behind it is the root's CSS background,
       so it stays screen-fixed and the cabinet reads as sitting inside it. */
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    if (this.shake > 0) ctx.translate(rnd(-this.shake, this.shake) * 0.4, rnd(-this.shake, this.shake) * 0.4);
    ctx.save(); ctx.translate(-this.camX, 0);
    const vwL = this.camX - 2 * R, vwR = this.camX + this.VW + 2 * R;
    const fx = X0 - 6, fy = 92, fw = this.WW - 2 * (X0 - 6), fh = this.LAUNCH_Y - 60;
    // recessed glass playfield: screen-fixed art clipped to the (possibly scrolling) field
    ctx.save(); ctx.beginPath();
    this.rrect(ctx, fx, fy, fw, fh, 26); ctx.clip();
    this.drawGlass(ctx, this.camX + fx, fy, this.VW - 2 * fx, fh);
    // parallax backdrop bubbles
    for (let i = 0; i < 12; i++) {
      let px = (i * 173.3 - this.camX * 0.45) % (this.VW + 160); if (px < 0) px += this.VW + 160;
      px += this.camX - 80;
      const py = 960 - ((i * 97 + this.now * (14 + (i % 5) * 7)) % 860);
      const pr = 14 + (i % 4) * 12;
      ctx.fillStyle = 'rgba(150,170,255,0.05)';
      ctx.beginPath(); ctx.arc(px, py, pr, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(170,190,255,0.08)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, 7); ctx.stroke();
    }
    // honeycomb ghost grid
    ctx.strokeStyle = 'rgba(160,180,255,0.09)'; ctx.lineWidth = 1.4;
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
    const cg = ctx.createLinearGradient(0, fy, 0, cy);
    cg.addColorStop(0, '#231d5c'); cg.addColorStop(1, '#3a3290');
    ctx.fillStyle = cg; ctx.fillRect(fx, fy, fw, cy - fy);
    ctx.strokeStyle = 'rgba(170,160,255,0.45)'; ctx.lineWidth = 2;
    const hx0 = Math.floor(Math.max(X0, this.camX) / 26) * 26;
    for (let x = hx0; x < Math.min(this.WW - X0, this.camX + this.VW); x += 26) {
      ctx.beginPath(); ctx.moveTo(x, cy - 3); ctx.lineTo(x + 12, cy - 16); ctx.stroke();
    }
    ctx.fillStyle = '#8fdcff'; ctx.fillRect(fx, cy - 4, fw, 4);
    const tg = ctx.createLinearGradient(0, cy, 0, cy + 22);
    tg.addColorStop(0, 'rgba(120,200,255,0.22)'); tg.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = tg; ctx.fillRect(fx, cy, fw, 22);
    // cabinet frame (screen-fixed, behind every live object)
    ctx.save(); ctx.translate(this.camX, 0); this.drawCabinet(ctx); ctx.restore();
    // attached bubbles; the pack shakes for the last shots before the ceiling drops
    const jit = this.packJitter();
    this.grid.forEach(b => {
      let x = this.cellX(b.r,b.c), y = this.cellY(b.r);
      if (jit) { x += jit.x; y += jit.y; }
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
      if (b.corrupted) {
        ctx.fillStyle = 'rgba(45,23,59,.72)'; ctx.strokeStyle = '#d772ea'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0,0,23,0,7); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#f2a7ff'; ctx.lineWidth = 4; ctx.beginPath();
        ctx.moveTo(-9,-9); ctx.lineTo(9,9); ctx.moveTo(9,-9); ctx.lineTo(-9,9); ctx.stroke();
      }
      if (b.special === 'triLock') {
        for (let plate = 0; plate < 3; plate++) {
          const owner = (b.contributors || [])[plate], a = -Math.PI / 2 + plate * Math.PI * 2 / 3;
          ctx.fillStyle = owner === undefined ? '#8290a7' : (META[owner] || META[0]).accent;
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(Math.cos(a) * 17, Math.sin(a) * 17, 7, 0, 7); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    });
    this.drawObjects(ctx,vwL,vwR);
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
    this.drawHurry(ctx);
    this.drawPassFx(ctx);
    this.drawPowerFx(ctx);
    this.drawTeamFx(ctx);
    // score popups (world-anchored)
    for (const p of (this.popups || [])) {
      const k = (this.now - p.t) / 1.1;
      ctx.globalAlpha = 1 - k; ctx.fillStyle = p.color;
      ctx.font = '700 30px Fredoka, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y - k * 46); ctx.globalAlpha = 1;
    }
    ctx.restore();
    // vignette + rescue drama (screen space)
    const vg = ctx.createRadialGradient(this.VW/2, this.H/2, this.H*0.35, this.VW/2, this.H/2, this.H*0.75);
    vg.addColorStop(0, 'rgba(40,70,120,0)'); vg.addColorStop(1, 'rgba(40,70,120,0.10)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, this.VW, this.H);
    if (this.teamPowerActive) this.drawPowerGlow(ctx);
    if (this.danger && this.state === 'play') {
      ctx.fillStyle = 'rgba(140,160,200,0.10)'; ctx.fillRect(0, 0, this.VW, this.H);
      const dp = 0.22 + Math.sin(this.now * 8) * 0.12;
      const eg = ctx.createRadialGradient(this.VW/2, this.H/2, this.H*0.3, this.VW/2, this.H/2, this.H*0.72);
      eg.addColorStop(0, 'rgba(255,91,107,0)'); eg.addColorStop(1, 'rgba(255,91,107,' + dp.toFixed(3) + ')');
      ctx.fillStyle = eg; ctx.fillRect(0, 0, this.VW, this.H);
    }
    // HUD
    this.drawHUD(ctx);
    this.callouts.forEach((c, idx) => {
      const k = (this.now - c.t) / 1.5, pop = Math.min(1, k * 6);
      ctx.save(); ctx.translate(this.VW/2, 320 + idx * 56); ctx.scale(0.6 + pop * 0.4, 0.6 + pop * 0.4);
      ctx.globalAlpha = Math.min(1, (1 - k) * 3);
      ctx.font = '700 44px Fredoka, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.strokeText(c.text, 0, 0);
      ctx.fillStyle = c.color; ctx.fillText(c.text, 0, 0);
      ctx.restore(); ctx.globalAlpha = 1;
    });
    ctx.font = '600 15px ui-monospace, monospace'; ctx.textAlign = 'left';
    if (!(this.tvActive && TV.hideSecondaryHud)) this.sfxLog.slice(-3).forEach((s, i) => {
      ctx.globalAlpha = Math.max(0, 1 - (this.now - s.t) / 1.6) * 0.55;
      ctx.fillStyle = '#3a5a80'; ctx.fillText('\u266a ' + s.name, X0 + 6, this.LAUNCH_Y - 78 - i * 20);
    });
    ctx.globalAlpha = 1;
  }
  /* ---------- hurry-up ----------
     Local play runs hurryTick in update(); online the server does and sends `hurry` and an
     auto-fired `launch`, with each launcher's idle clock in the snapshot for the countdown. */
  showHurry(i) {
    const humans = (this.players || []).filter(p => !p.bot).length, meta = META[i] || META[0];
    this.callout((humans > 1 ? meta.name + ' ' : '') + 'HURRY UP!', meta.accent);
    this.sfx('hurry');
  }
  // The seconds left before an idle launcher fires itself, counted down above its barrel.
  drawHurry(ctx) {
    const limit = Number(this.settings.hurry) || 0;
    if (!limit || this.state !== 'play' || this.battle) return;
    for (const p of this.players) {
      if (p.bot || !(p.idle > limit - PACE.hurryWarn)) continue;
      const left = Math.max(0, limit - p.idle), n = Math.ceil(left), k = n - left;
      ctx.save(); ctx.translate(p.x, this.LAUNCH_Y - 150); ctx.scale(1 + k * 0.25, 1 + k * 0.25);
      ctx.globalAlpha = 0.55 + 0.45 * (1 - k);
      ctx.textAlign = 'center'; ctx.font = '700 40px Fredoka, sans-serif';
      ctx.lineWidth = 7; ctx.strokeStyle = '#fff'; ctx.strokeText(String(n), 0, 0);
      ctx.fillStyle = '#ff5b6b'; ctx.fillText(String(n), 0, 0);
      ctx.restore();
    }
  }
  /* TEAM CHAIN ×N for Co-op Clear. The ring is the time left in the chain
     window, drawn in the colour of the player whose clear keeps it alive next; the badge
     breathes in that colour, and a handoff flashes a burst in the colour of whoever made it. */
  drawTeamChain(ctx, duo) {
    const ch = this.chain, fx = this.chainFx, k = clamp(ch.t / TEAM.chainSecs, 0, 1);
    const next = duo.includes(ch.last) ? duo.find(h => h !== ch.last) : duo[0];
    const nextCol = (META[next] || META[0]).accent;
    const pk = fx ? clamp((this.now - fx.pulseT) / 0.35, 0, 1) : 1, s = 1 + (1 - pk) * 0.22;
    const hk = fx ? (this.now - fx.handoffT) / 0.6 : 9;
    ctx.save(); ctx.translate(this.VW/2, 40);
    if (hk >= 0 && hk < 1) {
      ctx.globalAlpha = 1 - hk; ctx.strokeStyle = (META[fx.by] || META[0]).accent; ctx.lineWidth = 6 * (1 - hk);
      this.rrect(ctx, -80 - hk * 40, -28 - hk * 18, 160 + hk * 80, 54 + hk * 36, 27 + hk * 18); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.scale(s, s);
    ctx.shadowColor = 'rgba(120,90,220,0.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
    // Same footprint as the solo badge: it sits between the score and meter boxes, which
    // leave no more room than that on a narrow board.
    ctx.fillStyle = '#7b61d9';
    this.rrect(ctx, -74, -24, 148, 46, 23); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.now * 7) ** 2;
    ctx.strokeStyle = nextCol; ctx.lineWidth = 3; this.rrect(ctx, -74, -24, 148, 46, 23); ctx.stroke();
    ctx.globalAlpha = 1;
    // countdown ring, filled with the next player's colour
    ctx.fillStyle = nextCol; ctx.beginPath(); ctx.arc(-50, -1, 15, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(-50, -1, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = '#fff'; ctx.font = '700 12px Fredoka, sans-serif';
    ctx.fillText((META[next] || META[0]).name, -50, 3);
    ctx.font = '700 11px Fredoka, sans-serif'; ctx.fillText('TEAM CHAIN', 16, -5);
    ctx.font = '700 22px Fredoka, sans-serif'; ctx.fillText('\u00d7' + ch.mult, 16, 16);
    if (duo.length >= 3) duo.forEach((i, n) => {
      const x = (n - (duo.length - 1) / 2) * 31;
      ctx.fillStyle = ch.players.has(i) ? (META[i] || META[0]).accent : '#8290a7';
      ctx.beginPath(); ctx.arc(x, 34, 11, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 10px Fredoka, sans-serif'; ctx.fillText(String(i + 1), x, 38);
    });
    ctx.restore();
  }
  /* World-anchored assist burst: two rings and a spray of dots in the setup player's and
     the resolver's accents, with the TEAM ASSIST line filled in a blend of both. */
  drawTeamFx(ctx) {
    for (const f of this.teamFx || []) {
      const k = (this.now - f.t) / 1.6, e = 1 - (1 - Math.min(1, k * 2.2)) ** 3, big = f.big ? 1.6 : 1;
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.lineWidth = 6 * (1 - k);
      ctx.strokeStyle = f.c1; ctx.beginPath(); ctx.arc(f.x, f.y, (30 + 90 * e) * big, 0, 7); ctx.stroke();
      ctx.strokeStyle = f.c2; ctx.beginPath(); ctx.arc(f.x, f.y, (18 + 64 * e) * big, 0, 7); ctx.stroke();
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2 + (i & 1) * 0.2, d = (24 + 120 * e) * big;
        ctx.fillStyle = i & 1 ? f.c2 : f.c1;
        ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 6 * (1 - k) + 1, 0, 7); ctx.fill();
      }
      if (!f.text) continue;
      // Above the cluster, unless that would run it into the HUD along the ceiling.
      const pop = Math.min(1, k * 7), ty = f.y < 200 ? f.y + 90 + k * 20 : f.y - 60 - k * 30;
      ctx.save(); ctx.translate(clamp(f.x, 200, this.WW - 200), ty); ctx.scale(0.6 + pop * 0.4, 0.6 + pop * 0.4);
      ctx.font = '700 34px Fredoka, sans-serif'; ctx.textAlign = 'center';
      const w = ctx.measureText(f.text).width, g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, f.c1); g.addColorStop(1, f.c2);
      ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = g; ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  drawObjects(ctx, left, right) {
    if (this.settings.mode !== 'clear') return;
    const objects = this.objects || [];
    ctx.save();
    for (const o of objects) if (o.type === 'syncLock' && o.state !== 'open') {
      const pair = objects.find(p => p.id === o.pair);
      if (!pair || o.id > pair.id) continue;
      const [r,c] = o.cells[0], [pr,pc] = pair.cells[0];
      ctx.strokeStyle = '#8ddcff'; ctx.globalAlpha = .38; ctx.lineWidth = 3;
      ctx.setLineDash([8,7]); ctx.beginPath(); ctx.moveTo(this.cellX(r,c),this.cellY(r));
      ctx.lineTo(this.cellX(pr,pc),this.cellY(pr)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    for (const o of objects) {
      if (o.state === 'done' || o.state === 'open') continue;
      const [r,c] = o.cells[0], x = this.cellX(r,c), y = this.cellY(r);
      if (x < left || x > right || !this.grid.has(key(r,c))) continue;
      ctx.save(); ctx.translate(x,y);
      const pulse = Math.sin(this.now * 7) * 1.5;
      if (o.type === 'shield') {
        ctx.fillStyle = o.state === 'ready' ? 'rgba(109,220,255,.32)' : 'rgba(109,220,255,.12)';
        ctx.strokeStyle = o.state === 'ready' ? '#a9f4ff' : '#ffe599'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0,0,25+pulse,0,7); ctx.fill(); ctx.stroke();
        if (o.state === 'exposed') {
          ctx.beginPath(); ctx.moveTo(-13,-18); ctx.lineTo(-2,-5); ctx.lineTo(7,-11); ctx.lineTo(15,3); ctx.stroke();
        }
      } else if (o.type === 'syncLock') {
        const partner = objects.find(p => p.id === o.pair);
        if (partner?.state === 'armed' && o.state !== 'armed') {
          ctx.strokeStyle = '#fff4ae'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0,0,30+pulse,0,7); ctx.stroke();
        }
        ctx.fillStyle = o.state === 'armed' ? (META[o.by] || META[0]).accent : '#8ddcff';
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath();
        ctx.moveTo(0,-23-pulse); ctx.lineTo(22+pulse,0); ctx.lineTo(0,23+pulse); ctx.lineTo(-22-pulse,0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#12395f'; ctx.font = 'bold 18px Fredoka'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('L',0,1);
      } else if (o.type === 'teamArmor') {
        for (let half = 0; half < 2; half++) {
          ctx.fillStyle = o.contributors[half] === undefined ? '#72829b' : (META[o.contributors[half]] || META[0]).accent;
          ctx.strokeStyle = '#e7f6ff'; ctx.lineWidth = 3; ctx.beginPath();
          ctx.arc(0,0,24+pulse,half ? Math.PI/2 : -Math.PI/2,half ? 3*Math.PI/2 : Math.PI/2);
          ctx.lineTo(0,0); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      } else if (o.type === 'corruption') {
        ctx.fillStyle = '#372147'; ctx.strokeStyle = '#d772ea'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0,0,24+pulse,0,7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f2a7ff'; ctx.font = 'bold 24px Fredoka'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!',0,1);
      }
      if (o.timer > 0 && (o.state === 'armed' || o.state === 'exposed')) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.beginPath();
        ctx.arc(0,0,31,-Math.PI/2,-Math.PI/2 + Math.PI*2*o.timer/(o.type === 'shield' ? 6 : 5)); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  drawBubble(ctx, x, y, rad, kind, special, face, dangerPulse) {
    const spriteKey = (special === 'rainbow' || special === 'bomb') ? special : kind;
    const sprite = BUBBLE_SPRITES[spriteKey];
    if (special === 'stone' || special === 'triLock') this.drawStone(ctx, x, y, rad);
    else if (special === 'star') this.drawStar(ctx, x, y, rad);
    else if (sprite && sprite.complete && sprite.naturalWidth) {
      // Generated art replaces the old procedural sphere while the vector drawing below
      // remains a zero-network/loading fallback. Bomb gets a little extra room for its fuse.
      const size = rad * (special === 'bomb' ? 2.35 : 2.12);
      ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    } else if (special === 'rainbow') {
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
  /* Level-placed specials have no sprite yet. A stone is a grey riveted ball that reads as
     unpoppable; a star is a gold ball with a white star that glints. */
  drawStone(ctx, x, y, rad) {
    ctx.fillStyle = 'rgba(30,60,110,0.13)';
    ctx.beginPath(); ctx.ellipse(x + rad*0.1, y + rad*0.55, rad*0.85, rad*0.55, 0, 0, 7); ctx.fill();
    const g = ctx.createRadialGradient(x - rad*0.35, y - rad*0.4, rad*0.1, x, y, rad);
    g.addColorStop(0, '#d7dde6'); g.addColorStop(0.55, '#8d97a6'); g.addColorStop(1, '#5b6574');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    ctx.strokeStyle = '#4a5361'; ctx.lineWidth = rad * 0.1;
    ctx.beginPath(); ctx.arc(x, y, rad * 0.62, 0, 7); ctx.stroke();
    for (let i = 0; i < 4; i++) { // rivets
      const a = i * Math.PI / 2 + Math.PI / 4, rx = x + Math.cos(a) * rad * 0.62, ry = y + Math.sin(a) * rad * 0.62;
      ctx.fillStyle = '#e8ecf2'; ctx.beginPath(); ctx.arc(rx, ry, rad * 0.11, 0, 7); ctx.fill();
      ctx.fillStyle = '#4a5361'; ctx.beginPath(); ctx.arc(rx + rad*0.03, ry + rad*0.03, rad * 0.05, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(25,35,55,0.45)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, rad - 0.8, 0, 7); ctx.stroke();
  }
  drawStar(ctx, x, y, rad) {
    const g = ctx.createRadialGradient(x - rad*0.35, y - rad*0.45, rad*0.08, x, y, rad);
    g.addColorStop(0, '#fffbe6'); g.addColorStop(0.3, '#ffd84a'); g.addColorStop(1, '#d99a00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    const glint = 0.75 + 0.25 * Math.sin(this.now * 5 + x * 0.05);
    ctx.fillStyle = 'rgba(255,255,255,' + glint.toFixed(2) + ')'; ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i & 1 ? rad * 0.3 : rad * 0.72;
      if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(150,95,0,0.5)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, rad - 0.8, 0, 7); ctx.stroke();
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
    if (!p.cur) return;
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
  drawLauncherSprite(ctx, p) {
    const base = LAUNCHER_SPRITES.base, turret = LAUNCHER_SPRITES.turret;
    const shadow = LAUNCHER_SPRITES.shadow, muzzle = LAUNCHER_SPRITES.muzzle;
    const ready = img => img && img.complete && img.naturalWidth;
    if (!ready(base) || !ready(turret) || !ready(shadow)) return false;

    const x = p.x, y = this.LAUNCH_Y, meta = p.meta, cy = y - 44;
    const rk = p.recoilT !== undefined ? clamp((this.now - p.recoilT) / 0.18, 0, 1) : 1;
    const rec = (1 - rk) * 7, aa = clamp(p.angle, -1.22, 1.22);
    const ox = -Math.sin(aa) * rec, oy = Math.cos(aa) * rec;

    // V2 art is intentionally smaller and simpler. Each layer has its own authored
    // pivot instead of sharing the old generic sprite center.
    const size = 112;
    const drawAt = (img, ax, ay) =>
      ctx.drawImage(img, -ax * size, -ay * size, size, size);

    // Plant the shadow/base. The upper assembly pivots around the loaded bubble.
    ctx.save();
    ctx.translate(x, cy);
    ctx.globalAlpha = 0.38; drawAt(shadow, 0.5, 0.585);
    ctx.globalAlpha = 1; drawAt(base, 0.5, 0.495);
    ctx.restore();

    // Preserve pass/swap behavior, but draw the live bubbles underneath the metal
    // rims so they look seated in the chamber instead of pasted on top.
    const pk = this.passFx && (p.i === this.passFx.a || p.i === this.passFx.b)
      ? (this.now - this.passFx.t) / PASS_FX : 9;
    const cur = pk < 1 ? null : p.cur;
    const pulse = pk < 1.6 ? 1 + Math.sin((pk - 1) / 0.6 * Math.PI) * 0.18
      : cur?.swapT && this.now - cur.swapT < 0.5
        ? 1 + Math.sin((this.now - cur.swapT) * 20) * 0.12 : 1;

    ctx.globalAlpha = p.reload > 0 ? 0.45 : 1;
    if (cur) this.drawBubble(ctx, x + ox, cy + oy, 18 * pulse,
      cur.kind, cur.special, false, false);
    ctx.globalAlpha = 1;

    const next = p.next;
    const npulse = next?.swapT && this.now - next.swapT < 0.5
      ? 1 + Math.sin((this.now - next.swapT) * 20) * 0.12 : 1;
    if (next) {
      const ldx = -0.282 * size, ldy = -0.243 * size;
      const ca = Math.cos(aa), sa = Math.sin(aa);
      const nx = x + ox + ldx * ca - ldy * sa;
      const ny = cy + oy + ldx * sa + ldy * ca;
      this.drawBubble(ctx, nx, ny, 9.5 * npulse, next.kind, next.special, false, false);
    }

    // The rim, clamps, barrel and hopper rotate together and sit above the ammo.
    ctx.save();
    ctx.translate(x + ox, cy + oy);
    ctx.rotate(aa);
    drawAt(turret, 0.5, 0.585);
    ctx.restore();

    // Keep the gameplay feedback on top of the art where it remains readable.
    if (p.reload > 0) {
      const k = 1 - p.reload / this.settings.reload;
      ctx.strokeStyle = meta.accent; ctx.lineWidth = 4; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(x, cy, 39, -Math.PI/2, -Math.PI/2 + k * 6.283); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (pk < 1.8) {
      ctx.save(); ctx.globalAlpha = clamp(1 - pk / 1.8, 0, 1);
      ctx.strokeStyle = meta.accent; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x + ox, cy + oy, 31 + pk * 10, 0, 7); ctx.stroke();
      ctx.restore();
    }

    // Compact firing flash aligned to the authored barrel opening.
    const age = p.recoilT === undefined ? 9 : this.now - p.recoilT;
    if (ready(muzzle) && age >= 0 && age < 0.12) {
      const k = age / 0.12, fx = 72;
      ctx.save(); ctx.translate(x + ox, cy + oy); ctx.rotate(aa);
      ctx.globalAlpha = (1 - k) * 0.78;
      ctx.drawImage(muzzle, -fx * 0.5, -98, fx, fx);
      ctx.restore();
    }

    // Player identity stays outside the machine so four launchers remain scannable.
    ctx.fillStyle = meta.accent; ctx.strokeStyle = meta.accent;
    const iy = y + 20;
    ctx.lineWidth = 3;
    if (meta.icon === 'tri') {
      ctx.beginPath(); ctx.moveTo(x, iy - 9); ctx.lineTo(x + 9, iy + 7);
      ctx.lineTo(x - 9, iy + 7); ctx.closePath(); ctx.fill();
    } else if (meta.icon === 'square') {
      this.rrect(ctx, x - 8, iy - 8, 16, 16, 4); ctx.fill();
    } else if (meta.icon === 'ring') {
      ctx.beginPath(); ctx.arc(x, iy, 8, 0, 7); ctx.stroke();
    } else {
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI/2 + Math.PI/4;
        ctx.beginPath(); ctx.moveTo(x, iy);
        ctx.lineTo(x + Math.cos(a)*10, iy + Math.sin(a)*10); ctx.stroke();
      }
    }
    this.drawLauncherName(ctx, p, x, y + 44);
    return true;
  }

  drawLauncher(ctx, p) {
    if (this.settings.mode === 'clear' && this.players.length >= 2 && !this.battle) {
      ctx.save(); ctx.textAlign = 'center'; ctx.font = 'bold 14px Fredoka, sans-serif'; ctx.fillStyle = p.meta.accent;
      // Trio TV has no player cards: reserve a row below the name and status.
      const bombY = this.tvActive && this.tvLay?.key === 'coop3' ? 96 : 64;
      ctx.fillText('💣 ×' + (p.bombs || 0) + (p.bombLoaded ? ' +1 LOADED' : ' · B'), p.x, this.LAUNCH_Y + bombY);
      ctx.restore();
    }
    if (this.drawLauncherSprite(ctx, p)) return;
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
    // A passed bubble is in the air until PASS_FX; the pod refills when it lands.
    const pk = this.passFx && (p.i === this.passFx.a || p.i === this.passFx.b) ? (this.now - this.passFx.t) / PASS_FX : 9;
    const cur = pk < 1 ? null : p.cur;
    const pulse = pk < 1.6 ? 1 + Math.sin((pk - 1) / 0.6 * Math.PI) * 0.18
      : cur?.swapT && this.now - cur.swapT < 0.5 ? 1 + Math.sin((this.now - cur.swapT) * 20) * 0.12 : 1;
    if (pk < 1.8) {
      ctx.save(); ctx.globalAlpha = clamp(1 - pk / 1.8, 0, 1); ctx.strokeStyle = meta.accent; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, y - 44, 38 + pk * 16, 0, 7); ctx.stroke(); ctx.restore();
    }
    if (cur) this.drawBubble(ctx, x + ox, y - 44 + oy, 22 * pulse, cur.kind, cur.special, false, false);
    ctx.globalAlpha = 1;
    // glass dome gloss
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(x + ox - 8, y - 58 + oy, 16, 9, -0.5, 0, 7); ctx.fill();
    // next preview
    const next = p.next;
    const npulse = next?.swapT && this.now - next.swapT < 0.5 ? 1 + Math.sin((this.now - next.swapT) * 20) * 0.12 : 1;
    if (next) {
      this.drawBubble(ctx, x + 40, y + 6, 13 * npulse * this.tvTextScale(), next.kind, next.special, false, false);
      ctx.font = '600 ' + Math.round(12 * this.tvTextScale()) + 'px Fredoka, sans-serif'; ctx.fillStyle = '#7593b5'; ctx.textAlign = 'center';
      ctx.fillText('next', x + 40, y + 34);
    }
    // identity icon + label
    ctx.fillStyle = meta.accent; ctx.strokeStyle = meta.accent;
    const iy = y + 12;
    ctx.lineWidth = 3;
    if (meta.icon === 'tri') { ctx.beginPath(); ctx.moveTo(x, iy - 9); ctx.lineTo(x + 9, iy + 7); ctx.lineTo(x - 9, iy + 7); ctx.closePath(); ctx.fill(); }
    else if (meta.icon === 'square') { this.rrect(ctx, x - 8, iy - 8, 16, 16, 4); ctx.fill(); }
    else if (meta.icon === 'ring') { ctx.beginPath(); ctx.arc(x, iy, 8, 0, 7); ctx.stroke(); }
    else { for (let i = 0; i < 4; i++) { const a = i * Math.PI/2 + Math.PI/4;
      ctx.beginPath(); ctx.moveTo(x, iy); ctx.lineTo(x + Math.cos(a)*10, iy + Math.sin(a)*10); ctx.stroke(); } }
    this.drawLauncherName(ctx, p, x, y + 44);
  }
  // Outlined so the name reads on the tray art, its dark wells and the procedural plate alike.
  drawLauncherName(ctx, p, x, y) {
    ctx.font = '700 ' + Math.round(16 * this.tvTextScale()) + 'px Fredoka, sans-serif'; ctx.textAlign = 'center';
    const text = p.meta.name + (p.bot ? ' \u00b7 bot' : '');
    ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(18,14,56,0.85)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fff'; ctx.fillText(text, x, y);
    if (this.tvActive && this.tvLay?.key === 'coop3') {
      const status = this.chain?.t > 0 && this.chain.players.has(p.i) ? 'CHAIN' : p.reload > 0 ? 'RELOAD' : 'READY';
      ctx.font = '700 ' + Math.round(12 * this.tvTextScale()) + 'px Fredoka, sans-serif';
      ctx.strokeText(status, x, y + 25);
      ctx.fillStyle = p.meta.accent; ctx.fillText(status, x, y + 25);
    }
  }
  /* The glass panel at (x, y, w, h). The width sets the scale; a taller field repeats the
     quiet starfield `band`, mirrored so every join is seamless, and only the few percent left
     over is stretched, so a 1560-tall view never smears the art. Without the art it is a
     procedural night gradient with a neon rim. */
  drawGlass(ctx, x, y, w, h) {
    const img = themeImg('glass');
    if (!img) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#0b1240'); g.addColorStop(0.7, '#1a1f66'); g.addColorStop(1, '#3a2584');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(120,150,255,0.55)'; ctx.lineWidth = 4;
      this.rrect(ctx, x + 2, y + 2, w - 4, h - 4, 24); ctx.stroke();
      return;
    }
    const G = THEME_ART.glass, [b0, b1] = G.band, band = b1 - b0, end = G.sy + G.sh, s = w / G.sw;
    const reps = Math.max(0, Math.round((h / s - G.sh) / (2 * band))), k = h / (G.sh + 2 * reps * band);
    // [from, to] source rows in draw order; from > to runs the band upside down
    const parts = [];
    if (!reps) parts.push([G.sy, end]);
    else { parts.push([G.sy, b1]); for (let i = 0; i < 2 * reps - 1; i++) parts.push(i % 2 ? [b0, b1] : [b1, b0]); parts.push([b0, end]); }
    let dy = y;
    for (const [a, b] of parts) {
      const len = Math.abs(b - a), dh = len * k, pad = b === end ? 0 : 0.6; // overlap hides hairline seams
      if (b > a) ctx.drawImage(img, G.sx, a, G.sw, len, x, dy, w, dh + pad);
      else { ctx.save(); ctx.translate(0, dy + dh + pad); ctx.scale(1, -1);
        ctx.drawImage(img, G.sx, b, G.sw, len, x, 0, w, dh + pad); ctx.restore(); }
      dy += dh;
    }
  }
  /* The launcher deck is authored with two sockets. It is used only when both live launchers
     sit in them at a sane scale (two players on a classic field); anything else keeps the
     lower frame, so no player is forced into the two-socket art. */
  deckFit() {
    const img = themeImg('deck'), D = THEME_ART.deck;
    if (!img || this.WW !== W || !this.players || this.players.length !== 2) return null;
    const [a, b] = this.players, s = (b.x - a.x) / (D.sockets[1] - D.sockets[0]);
    if (!(s >= D.minScale && s <= D.maxScale)) return null;
    return { img, s, x: a.x - this.camX - D.sockets[0] * s, y: this.LAUNCH_Y - 44 + D.drop - D.socketY * s };
  }
  /* One side rail from y0 to y1: top cap, then as many whole tube sections as fit, then the
     foot. The small remainder is absorbed by scaling the whole rail a few percent. */
  drawRail(ctx, img, spec, y0, y1) {
    const sc = THEME_ART.rails.scale, iw = img.naturalWidth, ih = img.naturalHeight;
    const [t0, t1] = spec.tile, tile = t1 - t0, fixed = t0 + ih - t1, span = (y1 - y0) / sc;
    const n = Math.max(0, Math.round((span - fixed) / tile)), k = span / (fixed + n * tile);
    const dx = spec.at - spec.bar * sc;
    let y = y0;
    const piece = (a, b) => { const dh = (b - a) * sc * k;
      ctx.drawImage(img, 0, a, iw, b - a, dx, y, iw * sc, dh + (b === ih ? 0 : 0.6)); y += dh; };
    piece(0, t0); for (let i = 0; i < n; i++) piece(t0, t1); piece(t1, ih);
  }
  /* The cabinet, in screen space so a wide field scrolls beneath it. Drawn before any live
     object, so the art can never hide a bubble, an aim guide or the danger rail. */
  drawCabinet(ctx) {
    const RL = THEME_ART.rails, B = THEME_ART.bottom, deck = this.deckFit();
    const bottom = themeImg('bottom'), top = themeImg('top');
    const by = this.LAUNCH_Y + B.gap - B.trayY * B.scale;
    const railEnd = deck ? deck.y + 110 * deck.s : bottom ? by : this.LAUNCH_Y + 20;
    for (const side of ['left', 'right']) {
      const img = themeImg(side);
      // The right rail is authored against the classic edge; it rides the view's edge.
      const spec = side === 'right' ? { ...RL.right, at: RL.right.at + this.VW - W } : RL.left;
      if (img) this.drawRail(ctx, img, spec, RL.top, railEnd);
    }
    if (top) { const T = THEME_ART.top, tw = top.naturalWidth * T.scale, sh = Math.min(top.naturalHeight, (T.floor - T.y) / T.scale);
      ctx.drawImage(top, 0, 0, top.naturalWidth, sh, (this.VW - tw) / 2, T.y, tw, sh * T.scale); }
    if (deck) ctx.drawImage(deck.img, deck.x, deck.y, deck.img.naturalWidth * deck.s, deck.img.naturalHeight * deck.s);
    else if (bottom) { const bw = bottom.naturalWidth * B.scale;
      ctx.drawImage(bottom, (this.VW - bw) / 2, by, bw, bottom.naturalHeight * B.scale); }
    else { // procedural tray so the launcher labels always sit on a light plate
      const ty = this.LAUNCH_Y + 4;
      ctx.fillStyle = 'rgba(232,236,255,0.92)'; this.rrect(ctx, X0 - 6, ty, this.VW - 2 * (X0 - 6), this.H - ty - 6, 22); ctx.fill();
    }
  }
  /* A neon rail set into the chamber: dim and steady until the pack crosses it, then bright
     and pulsing. The rule itself (DANGER_Y) stays entirely in the simulation. */
  drawDanger(ctx) {
    const y = this.DANGER_Y, x0 = Math.max(X0, this.camX - 20), x1 = Math.min(this.WW - X0, this.camX + this.VW + 20);
    const on = !!this.danger, pulse = on ? 0.5 + Math.sin(this.now * 8) * 0.5 : 0;
    const line = () => { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); };
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(14,10,48,0.6)'; ctx.lineWidth = 9; line(); // housing
    ctx.shadowColor = on ? '#ff3b5c' : 'rgba(255,110,170,0.7)'; ctx.shadowBlur = on ? 12 + pulse * 14 : 6;
    ctx.strokeStyle = on ? 'rgb(255,' + Math.round(80 + pulse * 70) + ',110)' : 'rgba(255,120,175,0.6)';
    ctx.lineWidth = on ? 4 : 2.5; line();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,235,245,' + (on ? 0.5 + pulse * 0.4 : 0.35).toFixed(3) + ')';
    ctx.lineWidth = 1; line();
    ctx.restore();
    // outlined, since on a two-player deck the label sits over the socket art
    ctx.font = '600 14px Fredoka, sans-serif'; ctx.textAlign = 'right'; ctx.lineJoin = 'round';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(18,14,56,0.8)'; ctx.strokeText('danger line', this.camX + this.VW - X0 - 8, y - 8);
    ctx.fillStyle = on ? '#ffb3c0' : '#ff9fbd'; ctx.fillText('danger line', this.camX + this.VW - X0 - 8, y - 8);
    if (this.danger) {
      const pulse = 0.10 + Math.sin(this.now * 8) * 0.07;
      ctx.fillStyle = 'rgba(255,91,107,' + pulse + ')';
      ctx.fillRect(X0 - 6, y - ROWH * 1.6, this.WW - 2*(X0-6), ROWH * 1.6);
      // countdown
      const t = Math.max(0, this.danger.t), cx0 = this.camX + this.VW / 2;
      ctx.textAlign = 'center';
      ctx.font = '700 84px Fredoka, sans-serif';
      ctx.lineWidth = 10; ctx.strokeStyle = '#fff';
      ctx.strokeText(t.toFixed(1), cx0, y - 60);
      ctx.fillStyle = '#ff5b6b'; ctx.fillText(t.toFixed(1), cx0, y - 60);
      ctx.font = '600 22px Fredoka, sans-serif';
      ctx.lineWidth = 6; ctx.strokeText('CLEAR THE GLOWING BUBBLES!', cx0, y - 20);
      ctx.fillText('CLEAR THE GLOWING BUBBLES!', cx0, y - 20);
    }
  }
  // Launcher labels grow with the TV HUD; everywhere else they keep their desktop size.
  tvTextScale() { return this.tvActive ? TV.hudScale : 1; }
  drawHUD(ctx) {
    if (this.battle && this.settings.mode === 'battle' && !this.online) return this.drawBattleStrip(ctx);
    // The TV layout frames the field with its own DOM HUD (syncTvHud) instead.
    if (this.tvActive && this.tvLay && this.tvLay.hud) return;
    ctx.textAlign = 'left';
    // Keep both boxes clear of the corner buttons, which grow relative to a narrow board.
    const hx = this.chromeInset || X0;
    const mw = 170, mx = this.VW - hx - 12 - mw, my = 34;
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
    const duo = TEAM.feedback ? this.teamHumans() : [];
    if (this.chain.mult > 1 && duo.length >= 2) this.drawTeamChain(ctx, duo);
    else if (this.chain.mult > 1) {
      const k = clamp(this.chain.t / TEAM.chainSecs, 0, 1);
      const pk = this.chainFx ? clamp((this.now - this.chainFx.pulseT) / 0.35, 0, 1) : 1;
      const s = 1 + (1 - pk) * 0.22;
      ctx.save(); ctx.translate(this.VW/2, 40); ctx.scale(s, s);
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
         inset grows on a narrow board. Drop it rather than run it underneath them, and
         leave the space to the cabinet marquee when that is drawn. */
      ctx.fillStyle = '#9db8d4'; ctx.font = '600 17px Fredoka, sans-serif';
      const tag = this.settings.mode === 'clear' ? 'clear the field together!' : 'endless survival';
      if (!themeImg('top') && ctx.measureText(tag).width + 16 <= (mx - 12) - (hx + 190)) ctx.fillText(tag, this.VW/2, 42);
    }
    // miss meter (secondary)
    ctx.textAlign = 'right'; ctx.font = '600 13px Fredoka, sans-serif'; ctx.fillStyle = '#7593b5';
    ctx.fillText('MISS METER \u2192 ceiling drops', this.VW - hx - 14, my - 6);
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
      ctx.fillText(this.teamPowerActive && powerHolds(this.teamPowerActive, 'holdPressure') ? 'ROW PUSH HELD'
        : 'ROW PUSH IN ' + left + (left === 1 ? ' SHOT' : ' SHOTS'), this.VW - hx - 14, my + 30);
    }
    if (this.teamHumans().length >= 2) this.drawTeamPower(ctx);
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
    this._geoLocked = false;
    if (!this.online) {
      if (this.tvActive) this.setViewH(H0);
      else if (this._deviceViewH) this.setViewH(this._deviceViewH);
    }
    this.WW = W; this.cols = COLS; this.camX = 0;
    const n = clamp(this.settings.players, 2, 8);
    this.battle = { boards: [], phase: 'play', targeting: null, zoom: 0, order: [], winner: -1, spectate: false, view: 0 };
    this.levelColors = levelColors(this.levelRows());
    for (let i = 0; i < n; i++) this.battle.boards.push(this.makeBattleBoard(i, i !== 0));
    this.battle.human = this.battle.boards[0];
    this.flights = []; this.falling = []; this.pops = []; this.sparks = []; this.ripples = []; this.callouts = []; this.popups = []; this.sfxLog = [];
    this.batch = []; this.resolveAt = 0; this.danger = null; this.shake = 0; this.now = 0; this.dispScore = 0;
    this.chain = { mult: 1, last: -1, same: 0, players: new Set(), t: 0, trioAwarded: false };
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
    rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) { const cell = levelCell(row[c]);
      if (cell) b.grid.set(key(r, c), { r, c, ...cell, placedBy: -1 }); } });
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
    else p.aimTarget = null; // choosing a target parks the barrel where it is
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
        this.grid.forEach((g, kk) => { if (g.special !== 'stone' && g.special !== 'triLock' && Math.hypot(this.cellX(g.r, g.c) - bx, this.cellY(g.r) - by) <= R * 4.3) blast.add(kk); });
        results.push({ popped: blast, bomb: true });
      } else {
        let kind = l.kind;
        if (l.special === 'rainbow') {
          let best = null, bs = 0;
          for (const [nr, nc] of this.neighbors(l.r, l.c)) { const nb = this.grid.get(key(nr, nc));
            if (nb && !nb.special) { const sz = this.matchGroup(l.r, l.c, nb.kind).size; if (sz > bs) { bs = sz; best = nb.kind; } } }
          if (best) kind = best; else { results.push({ popped: null }); continue; }
        }
        const g = this.matchGroup(l.r, l.c, kind), star = starHit(this.grid, this.neighbors(l.r, l.c), l, kind);
        if (star) { g.forEach(kk => star.add(kk)); results.push({ popped: star }); continue; }
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
      rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) { const cell = levelCell(row[c]);
        if (cell) this.grid.set(key(r, c), { r, c, ...cell, placedBy: -1,
          snapFrom: { x: this.cellX(r, c), y: this.cellY(r) - 500 }, snapT: this.now + r * 0.04 }); } });
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
    ctx.save(); this.rrect(ctx, 0, 0, W, this.H, 36); ctx.clip();
    this.drawGlass(ctx, 0, 0, W, this.H); ctx.restore();
    this.rrect(ctx, 0, 0, W, this.H, 36);
    const selectable = tg && tg.by === this.battle.human.i && b.alive && b.i !== tg.by;
    ctx.lineWidth = hov ? 16 : 8;
    ctx.strokeStyle = hov ? '#ff8a3c' : selectable ? b.meta.accent : 'rgba(120,150,190,0.5)';
    ctx.stroke();
    ctx.fillStyle = '#3a3290'; ctx.fillRect(18, 40, W - 36, Math.max(0, this.ceilingY() - 40));
    const left = b.perDrop ? b.perDrop - (b.pressure || 0) : 0, jit = b.alive && left > 0 && left <= PACE.warnShots
      ? { x: Math.sin(this.now * 47 + b.i) * 4, y: 0 } : { x: 0, y: 0 };
    this.grid.forEach(g => {
      const x = this.cellX(g.r, g.c) + jit.x, y = this.cellY(g.r) + jit.y;
      this.drawBubble(ctx, x, y, R - 2, g.kind, g.special, false, false);
    });
    for (const f of this.flights) this.drawBubble(ctx, f.x, f.y, R - 4, f.kind, f.special, false, false);
    for (const f of this.falling) {
      ctx.globalAlpha = 0.7; this.drawBubble(ctx, f.x, f.y, R - 4, f.kind, f.special, false, false); ctx.globalAlpha = 1;
    }
    ctx.setLineDash([18, 14]); ctx.lineWidth = 5; ctx.strokeStyle = b.danger ? '#ff5b6b' : 'rgba(255,91,107,0.5)';
    ctx.beginPath(); ctx.moveTo(18, this.DANGER_Y); ctx.lineTo(W - 18, this.DANGER_Y); ctx.stroke(); ctx.setLineDash([]);
    const p = b.player;
    ctx.save(); ctx.translate(p.x, this.LAUNCH_Y - 44); ctx.rotate(clamp(p.angle, -1.22, 1.22));
    ctx.fillStyle = b.meta.accent; this.rrect(ctx, -14, -70, 28, 52, 12); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, this.LAUNCH_Y - 44, 34, 0, 7); ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = b.meta.accent; ctx.beginPath(); ctx.arc(p.x, this.LAUNCH_Y - 44, 34, 0, 7); ctx.stroke();
    if (p.cur) this.drawBubble(ctx, p.x, this.LAUNCH_Y - 44, 22, p.cur.kind, p.cur.special, false, false);
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
    this.tutEl.style.display = 'grid'; this.state = 'tutorial'; this._tutBack = null;
  }

  /* ---------- DOM / UI ---------- */
  buildDOM() {
    const sh = this.attachShadow({ mode: 'open' });
    sh.innerHTML = `
<style>
:host{display:block;width:100%;height:100%;font-family:'Fredoka',sans-serif;color:#17335c}
/* Dev diagnostics: fixed box, text-only updates a few times a second, never in the flow. */
.perfHud{display:none;position:absolute;left:8px;top:8px;z-index:99;margin:0;padding:6px 9px;border-radius:8px;background:rgba(10,20,40,.78);color:#bfffcf;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre;pointer-events:none;contain:layout paint}
:host(:fullscreen),:host(:-webkit-full-screen){width:100vw;height:100vh;height:100dvh;background:#0c1030}
*{box-sizing:border-box}
/* The fantasy world paints the full root, outside the content safe area. Cover crops it
   to every viewport shape; the trailing gradient is the fallback if the art never loads. */
.root{--worldBg:radial-gradient(ellipse 60% 70% at 50% 50%,rgba(6,8,30,.62),rgba(6,8,30,.3) 70%,rgba(6,8,30,.15)),url(${THEME_URLS.background}) center/cover no-repeat,linear-gradient(#1c2160,#0c1030);
 --sideW:290px;--rootGap:20px;position:relative;display:flex;width:100%;height:100%;background:var(--worldBg);align-items:center;justify-content:center;gap:var(--rootGap);overflow:hidden;
 padding:max(clamp(24px,5vh,80px),env(safe-area-inset-top)) max(clamp(24px,5vw,80px),env(safe-area-inset-right)) max(clamp(24px,5vh,80px),env(safe-area-inset-bottom)) max(clamp(24px,5vw,80px),env(safe-area-inset-left))}
/* relayout() sets the board's pixel size outright. Letterboxing it in pure CSS needs a
   definite height, and a definite height plus max-width makes the browser break the
   aspect ratio rather than shrink — hence the old viewport-unit calc(). The rules below
   are only the pre-measure first paint. */
.gameCol{position:relative;flex:none;height:100%;width:auto;max-width:100%;max-height:100%;aspect-ratio:var(--fieldAspect,.59259);min-width:0}
canvas{width:100%;height:100%;display:block;border-radius:22px;touch-action:none}
.pad{position:absolute;left:50%;transform:translateX(-50%);bottom:4px;display:flex;gap:10px;z-index:4}
/* The UA tap highlight is its own blue wash on top of ours, so an aim half tinted at 0%
   still flashed on touch. Ours is the only pressed feedback these controls get. */
.pad button{border:0;border-radius:12px;background:rgba(255,255,255,.94);box-shadow:0 4px 14px rgba(40,80,140,.25);font:inherit;font-weight:700;color:#2b4a70;cursor:pointer;padding:7px 20px;font-size:17px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.pad button:active{background:#2b6fd4;color:#fff}
/* The point-to-aim surface only exists on touch layouts in that mode; everywhere else it is
   absent from hit-testing entirely rather than merely transparent. touch-action:none is what
   makes a drag work at all: without it the browser claims the gesture as a possible scroll
   and cancels the pointer one move in, so the barrel would follow the finger for a single
   frame and then stop dead. */
.pad .padA{display:none;position:absolute;inset:0;touch-action:none;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
.pad .padF{background:#ff6fb1;color:#fff;font-size:14px;letter-spacing:.06em}
/* PASS only exists in two-human Co-op Clear (syncPassButton adds .on). While cooling, the
   violet wedge is the share of the shared cooldown still to run. */
.pad .padP,.pad .padPL{display:none;color:#7a5cd6;font-size:14px;letter-spacing:.06em;min-width:6.4em;text-align:center}
.pad .padP.on,.pad .padPL.on{display:inline-block}
.pad .padP.cooling,.pad .padPL.cooling{color:#9db8d4;background:conic-gradient(rgba(167,139,250,.38) calc(var(--passK,0) * 360deg),rgba(255,255,255,.94) 0)}
.pad .padP.flash,.pad .padPL.flash{animation:passFlash .45s ease-out}
.pad .padP.shake,.pad .padPL.shake{animation:passShake .3s linear}
@keyframes passFlash{0%{background:#a78bfa;color:#fff;box-shadow:0 0 0 8px rgba(167,139,250,.45)}}
@keyframes passShake{25%{translate:-5px 0}50%{translate:5px 0}75%{translate:-3px 0}}
/* TEAM POWER only exists in two-human Co-op Clear (syncPowerButton adds .on). The violet
   fill is the shared meter; READY turns it rainbow and makes it breathe. */
.pad .padT{display:none;color:#7b61d9;font-size:13px;letter-spacing:.04em;min-width:8.6em;text-align:center;background:linear-gradient(90deg,rgba(167,139,250,.35) calc(var(--powerK,0) * 100%),rgba(255,255,255,.94) 0)}
.pad .padT.on{display:inline-block}
.pad .padT.ready{color:#fff;text-shadow:0 1px 2px rgba(40,20,90,.5);background:linear-gradient(90deg,#ff5b6b,#ffc233,#3ecf72,#3f9dff,#a78bfa,#ff5b6b);background-size:200% 100%;box-shadow:0 0 0 4px rgba(123,97,217,.35),0 4px 14px rgba(40,80,140,.25);animation:powerReady 1.2s linear infinite}
.pad .padT.active{color:#fff;background:#7b61d9}
.pad .padT.shake{animation:passShake .3s linear}
@keyframes powerReady{0%{background-position:0 0;scale:1}50%{scale:1.07}100%{background-position:200% 0;scale:1}}
/* Which build is on screen, for telling a stale cached bundle from a fresh one. Sits
   under the pad's z-index and takes no pointer events, so it never eats an aim drag. */
.buildTag{position:absolute;right:8px;bottom:3px;z-index:3;pointer-events:none;user-select:none;
 font-size:clamp(8px,calc(10px * var(--u,1)),12px);letter-spacing:.02em;color:rgba(43,74,112,.38)}
.side{width:var(--sideW);flex:none;height:100%;overflow-y:auto;background:#fff;border-radius:20px;padding:18px;box-shadow:0 8px 30px rgba(40,80,140,.12);font-size:14px}
.side h3{margin:14px 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#7593b5}
.side h2{margin:0 0 4px;font-size:20px}
/* On narrow layouts the panel is a drawer over the board, and the gear that opened it is
   behind it — so the drawer carries its own way out. Escape closes it too. */
.sideClose{float:right;border:0;background:#f4f9ff;border-radius:50%;width:30px;height:30px;color:#7593b5;font:700 15px/1 Fredoka,sans-serif;cursor:pointer;display:none}
.root:not(.wideLayout) .sideClose{display:block}
.luStats{margin:10px 0 4px;text-align:left}
.luTime{margin:-6px 0 10px;font-weight:700;color:#2b6fd4}
.luReady{min-height:18px;color:#7593b5;font-size:13px;margin-bottom:10px}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0}
.seg{display:flex;gap:4px}
.lvlSel{width:100%;border:2px solid #d7e6f5;border-radius:10px;padding:6px 8px;font:inherit;font-size:13px;color:#2b4a70;background:#f4f9ff}
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
.padPickSides{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0 12px}
.padPickSide{border:3px solid #d7e6f5;border-radius:18px;padding:18px 10px;text-align:center;background:#f4f9ff;transition:.12s ease}
.padPickSide b{display:block;font-size:22px;color:#2b4a70}.padPickSide span{display:block;margin-top:6px;color:#7593b5;font-weight:600}
.padPickSide.hot{border-color:#ffc233;box-shadow:0 0 0 4px rgba(255,194,51,.2);transform:translateY(-2px)}
.padPickSide.picked{border-color:#2b6fd4;background:#eaf2ff}.padPickSide.picked span{color:#2b6fd4}
.padPickStatus{text-align:center;min-height:42px;color:#3d5f86;font-weight:600;margin:6px 0 2px}
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
   touch targets never drop below ~36px.

   It sits above .overlay (z-index 5), not below it. Underneath, the gear was unreachable
   behind every card the game shows — pause, level complete, game over, the tutorial — which
   is most of the moments you actually want the settings. */
.cornerButton{position:absolute;top:var(--chromeGap);z-index:6;width:var(--chromeBtn);height:var(--chromeBtn);border-radius:50%;border:0;background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(40,80,140,.25);color:#2b4a70;font:700 clamp(16px,calc(22px * var(--u,1)),28px)/1 Fredoka,sans-serif;cursor:pointer;display:grid;place-items:center;touch-action:manipulation}
.gameCol{--chromeBtn:clamp(36px,calc(44px * var(--u,1)),56px);--chromeGap:clamp(6px,calc(10px * var(--u,1)),14px)}
.fullscreenButton{left:var(--chromeGap)}.fullscreenButton[hidden]{display:none}.gear{right:var(--chromeGap);display:none;font-size:clamp(15px,calc(20px * var(--u,1)),25px)}.fullscreenButton .exitIcon{display:none}.fullscreenButton.isFullscreen .enterIcon{display:none}.fullscreenButton.isFullscreen .exitIcon{display:inline}
.statRow{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:#f4f9ff;margin:6px 0;font-size:14px}
.statRow .who{font-weight:700;width:34px}
.statRow.team{background:#e6f0ff;font-size:15px}.statRow.team .who{width:auto;min-width:34px}.statRow.team .nums{color:#17335c;font-weight:600}
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
.homeActions{display:grid;gap:9px;margin-top:18px}.localCampaignButtons{display:grid;grid-template-columns:1fr 1fr;gap:8px}.localCampaignButtons .btn{margin:0}.joinFields{display:grid;grid-template-columns:1fr 110px;gap:8px;margin-top:12px}
.textInput{width:100%;border:2px solid #d7e6f5;border-radius:11px;padding:10px;font:inherit;color:#17335c;background:#f8fbff}
.lobbyCard{width:min(540px,92%)}.roomCode{font:700 52px ui-monospace,monospace;letter-spacing:.18em;text-align:center;color:#2b6fd4;margin:6px 0}
.onlinePlayers{display:grid;gap:6px;margin:12px 0}.onlinePlayer{display:flex;align-items:center;gap:9px;padding:8px 10px;background:#f4f9ff;border-radius:10px}
.statusDot{width:10px;height:10px;border-radius:50%;background:#3ecf72}.statusDot.off{background:#a9b8c8}.hostTag{margin-left:auto;color:#7593b5;font-size:12px}
.lobbySettings{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}.lobbySettings label{display:grid;gap:3px;font-size:12px;color:#7593b5}.lobbySettings select,.lobbySettings input,.lobbySettings textarea{border:2px solid #d7e6f5;border-radius:8px;padding:6px;font:inherit;color:#2b4a70;background:#f8fbff;min-width:0}
.lobbySettings .full{grid-column:1/-1}
@container (max-width:330px){.lobbySettings{grid-template-columns:1fr}.localCampaignButtons,.joinFields{grid-template-columns:1fr}.roomCode{font-size:38px}}.onlineBar{position:absolute;left:calc(var(--chromeBtn) + var(--chromeGap) * 2);right:calc(var(--chromeBtn) + var(--chromeGap) * 2);top:var(--chromeGap);z-index:6;display:none;gap:6px;pointer-events:none}.onlineBar button,.onlineBar span{pointer-events:auto;border:0;border-radius:10px;padding:7px 10px;background:rgba(255,255,255,.94);color:#2b4a70;font:600 12px Fredoka,sans-serif;box-shadow:0 3px 12px rgba(40,80,140,.18)}
.onlineBar .netState{margin-left:auto}.onlineBar .bad{color:#d13a4c}.formError{min-height:18px;color:#d13a4c;font-size:13px;margin-top:6px}.reconnect .card{text-align:center}
/* Whether the side panel fits is a question about the space left beside the board, not
   about viewport width, so relayout() sets .wideLayout and this rule follows it. That is
   what reclaims phone landscape and the unfolded Fold, where a viewport-width test failed. */
/* Padding is keyed to the viewport, never to .wideLayout: relayout() measures the padded
   box to make that decision, so letting the class change the padding would feed the
   decision back into its own input. Compact touch screens keep their larger playfield. */
@media (max-width:520px),(max-height:520px){.root{padding:max(6px,env(safe-area-inset-top)) max(6px,env(safe-area-inset-right)) max(6px,env(safe-area-inset-bottom)) max(6px,env(safe-area-inset-left))}}
.root:not(.wideLayout) .side{display:none}
.root:not(.wideLayout) .gear{display:grid}
.root:not(.wideLayout) .onlineBar{gap:4px}
.root:not(.wideLayout) .onlineBar .onlineRoomLabel{display:none}
.root:not(.wideLayout) .onlineBar button,.root:not(.wideLayout) .onlineBar span{padding:6px 7px;font-size:11px}
.root:not(.wideLayout) .side.open{display:block;position:absolute;right:8px;top:60px;bottom:8px;z-index:7;width:min(300px,80%)}
@media (hover:none) and (pointer:coarse){
 .pad{left:0;right:0;bottom:0;height:50%;transform:none;display:block;pointer-events:none}
 .pad button{pointer-events:auto}
 .pad .padL,.pad .padR{position:absolute;bottom:0;width:50%;height:100%;padding:0 calc(24px * var(--u,1)) calc(24px * var(--u,1));border-radius:0;background:transparent;box-shadow:none;color:rgba(43,74,112,.48);display:flex;align-items:flex-end;font-size:clamp(18px,calc(26px * var(--u,1)),34px)}
 .pad .padL{left:0;justify-content:flex-start}
 .pad .padR{right:0;justify-content:flex-end}
 /* At 0% the whole pressed state goes away, arrow ink included, so "off" really is
    invisible rather than merely a fainter wash. */
 .pad .padL:active,.pad .padR:active{background:rgba(43,111,212,var(--padTint,.025));color:var(--padInk,#2b6fd4)}
 /* --fireScale multiplies the whole button, so the label and the tap target grow together. */
 .pad .padF{position:absolute;left:50%;bottom:calc(18px * var(--u,1));z-index:2;transform:translateX(-50%);padding:calc(12px * var(--u,1) * var(--fireScale,1)) calc(28px * var(--u,1) * var(--fireScale,1));font-size:calc(clamp(11px,calc(14px * var(--u,1)),19px) * var(--fireScale,1));border-radius:calc(14px * var(--fireScale,1));box-shadow:0 4px 14px rgba(40,80,140,.25)}
 /* Point-to-aim replaces the two halves with one surface over the whole board: you aim by
    touching where you want the shot to go, so the surface has to reach the targets, not just
    the thumb rest. FIRE keeps its z-index above it, and padHit checks it first anyway, so the
    only thing that changes is what an otherwise-unclaimed touch means. The chrome sits at
    z-index 6 unconditionally, so a full-board drag cannot eat the gear here either. */
 /* PASS sits in the outer corner on the side of this player's launcher, clear of FIRE's
    near-miss halo and above the aim-half arrows; padHit ranks it over the aim surfaces. */
 .pad .padP,.pad .padPL{position:absolute;bottom:calc(64px * var(--u,1));z-index:2;padding:calc(12px * var(--u,1)) calc(16px * var(--u,1));font-size:clamp(11px,calc(14px * var(--u,1)),19px);min-width:6.4em;min-height:40px;border-radius:14px}
 .pad .padPL{bottom:calc(114px * var(--u,1))}
 .pad .padP[data-side="left"],.pad .padPL[data-side="left"]{left:calc(10px * var(--u,1))}
 .pad .padP:not([data-side="left"]),.pad .padPL:not([data-side="left"]){right:calc(10px * var(--u,1))}
 /* TEAM POWER takes PASS's row in the opposite corner: stacked above PASS it would sit on
    top of this player's own launcher pod. */
 .pad .padT{position:absolute;bottom:calc(64px * var(--u,1));z-index:2;padding:calc(12px * var(--u,1)) calc(14px * var(--u,1));font-size:clamp(11px,calc(13px * var(--u,1)),18px);min-width:8.6em;min-height:40px;border-radius:14px}
 .pad .padT[data-side="left"]{left:calc(10px * var(--u,1))}
 .pad .padT:not([data-side="left"]){right:calc(10px * var(--u,1))}
 .root[data-aim-mode="point"] .pad{top:0;height:100%}
 .root[data-aim-mode="point"] .pad .padA{display:block;pointer-events:auto;background:transparent}
 .root[data-aim-mode="point"] .pad .padA:active{background:rgba(43,111,212,var(--padTint,.025))}
 .root[data-aim-mode="point"] .pad .padL,.root[data-aim-mode="point"] .pad .padR{display:none}
}
/* ---------- TV / couch display (.tvMode; measure() decides it from the Display setting) ----------
   .gameCol becomes the fixed 1920x1080 logical stage, sized in real px by relayout(); --tvS is
   stage px per logical px. Everything here is authored in logical px and multiplied by --tvS,
   so 1080p and 4K get the same composition and a non-16:9 screen letterboxes. The root art
   still covers the viewport outside that stage; Screen Fit controls its own UI inset. */
.tvHud,.tvOnly,.tvSmall{display:none}
.root.tvMode{padding:0;gap:0;background:var(--worldBg)}
.root.tvMode .gameCol{flex:none;aspect-ratio:auto;max-width:none;max-height:none;overflow:hidden;
 background:transparent;box-shadow:inset 0 0 60px rgba(0,0,0,.45)}
.root.tvMode.tvTooSmall .tvSmall{display:grid;place-items:center;z-index:20;padding:20px;background:rgba(4,12,28,.92);backdrop-filter:blur(6px)}
.root.tvMode .tvSmall .card{width:auto;max-width:480px;transform:none;padding:28px 24px;border-radius:20px;font-size:16px;line-height:1.4;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.6)}
.root.tvMode .tvSmall h2{font-size:22px;margin:0 0 10px;line-height:1.2;color:#17335c}
.root.tvMode .tvSmall p{font-size:16px;margin:0 0 20px;color:#3d5f86}
.root.tvMode .tvSmall .tvSmallActions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.root.tvMode .tvSmall .btn{font-size:16px;padding:10px 20px;border-radius:12px}
.root.tvMode canvas{position:absolute;left:calc(var(--pfX) * var(--tvS));top:calc(var(--pfY) * var(--tvS));width:calc(var(--pfW) * var(--tvS));height:calc(var(--pfH) * var(--tvS));
 border-radius:calc(26px * var(--tvS))}
.root.tvMode .overlay{border-radius:0;box-sizing:border-box;background:rgba(8,22,46,.62);
 padding:calc(var(--tvSafeY) * var(--tvS)) calc(var(--tvSafeR) * var(--tvS)) calc((var(--tvSafeB) + var(--tvPromptH)) * var(--tvS)) calc(var(--tvSafeX) * var(--tvS))}
.root.tvMode .tvOnly{display:block}.root.tvMode .tvOnly[hidden]{display:none}
.root.tvMode.isFullscreen .tvFullscreen{display:none}
.root.tvMode .cornerButton{top:calc(var(--tvSafeY) * var(--tvS));width:calc(var(--tvChrome) * var(--tvS));height:calc(var(--tvChrome) * var(--tvS));font-size:calc(34px * var(--tvS))}
.root.tvMode .fullscreenButton{left:calc(var(--tvSafeX) * var(--tvS))}
.root.tvMode .gear{display:grid;right:calc(var(--tvSafeR) * var(--tvS))}
.root.tvMode .buildTag{right:calc(var(--tvSafeR) * var(--tvS));bottom:calc(8px * var(--tvS));font-size:calc(13px * var(--tvS));color:rgba(255,255,255,.35)}
/* Menus: authored at a fixed logical size, then scaled by stage × menuScale from their centre.
   Type comes from TV.menuType via --tvM-* (already divided by menuScale), so every label
   reaches the screen at >= minMenuFontPx; low-contrast greys darken for the far seat. */
.root.tvMode .card{--u:1;width:640px;max-width:none;max-height:calc((var(--tvSafeH) - var(--tvPromptH)) / var(--tvMenuScale));transform:scale(var(--tvMenuK));font-size:var(--tvM-body);line-height:1.3}
.root.tvMode .lobbyCard{width:720px}
.root.tvMode .card h1{font-size:var(--tvM-title);line-height:1.1}
.root.tvMode .card :is(.sub,p,label,h3,.row>span,.tut p,.luTime,.luReady,.formError,.hsPrompt,.hsNote,.hostTag,.statRow,.statRow .nums,.statRow.team,.hsRow,.hiscore h3,.lobbySettings label,.onlinePlayer){font-size:var(--tvM-body)}
.root.tvMode .card :is(.sub,.luReady,.hsNote,.hostTag,.lobbySettings label){color:#3d5f86}
.root.tvMode .card .statRow .nums{color:#2b4a70}
.root.tvMode .tut .n{width:1.3em;height:1.3em;font-size:var(--tvM-body)}
.root.tvMode .card .btn{padding:.5em;font-size:var(--tvM-button);border-radius:16px;font-weight:700}
.root.tvMode .card :is(.textInput,select,textarea,.lobbySettings input,.lobbySettings select){padding:.35em .5em;font-size:var(--tvM-control)}
.root.tvMode .card .seg button{padding:.3em .6em;font-size:var(--tvM-control);font-weight:600}
.root.tvMode .card .roomCode{font-size:var(--tvM-code)}
.root.tvMode .card .hsIn{width:6em;font-size:var(--tvM-code)}
.root.tvMode .joinFields{grid-template-columns:1fr 5em}
.root.tvMode .side.open{position:absolute;display:block;z-index:7;top:calc(var(--tvY) + var(--tvSafeY) * var(--tvS));right:calc(var(--tvX) + var(--tvSafeR) * var(--tvS));bottom:auto;
 width:460px;height:calc((var(--tvSafeH) - var(--tvPromptH)) / var(--tvMenuScale));transform:scale(var(--tvMenuK));transform-origin:100% 0;font-size:var(--tvM-body);color:#17335c}
.root.tvMode .side :is(h3,.val,.lvlSel,details summary,.ctrlList,.seg button,.row>span,.pName){font-size:var(--tvM-small)}
.root.tvMode .side h2{font-size:var(--tvM-title)}
.root.tvMode .side [style*="font-size"]{font-size:var(--tvM-small)!important;color:#3d5f86!important}
.root.tvMode .side h3{color:#3d5f86}
.root.tvMode .side .val{width:auto;min-width:3.2em;color:#2b4a70}
.root.tvMode .side .seg{flex-wrap:wrap}.root.tvMode .side .seg button{padding:.25em .55em}.root.tvMode .side .row{margin:12px 0;flex-wrap:wrap}
.root.tvMode .side .btn{font-size:var(--tvM-button);padding:.4em}
.root.tvMode .side .pName{width:auto}
.root.tvMode input[type=range]{width:190px;height:34px}
.root.tvMode .sideClose{display:block;width:1.8em;height:1.8em;font-size:var(--tvM-body)}
/* Controller focus has to read from the sofa without relying on colour alone: a thick gold
   ring over a dark halo, a lift, and a ▶ marker on focused buttons. Selected segment choices
   carry a ✓ as well as their fill. */
.root.tvMode :is(button,select,input,textarea,summary):focus{outline:5px solid #ffc233;outline-offset:3px;box-shadow:0 0 0 3px #0b1f3d,0 0 0 13px rgba(255,194,51,.5)}
.root.tvMode :is(.btn,.seg button,.sfStep):focus{transform:scale(1.05)}
.root.tvMode .btn:focus::before{content:'\\25b6\\00a0'}
.root.tvMode .seg button.on{border-width:3px}
.root.tvMode .seg button.on::before{content:'\\2713\\00a0'}
.root.tvMode .onlineBar{left:calc(var(--infoX) * var(--tvS));top:calc(var(--infoY) * var(--tvS));right:auto;width:calc(var(--infoW) / var(--tvHudS));flex-wrap:wrap;transform:scale(calc(var(--tvS) * var(--tvHudS)));transform-origin:0 0}
.root.tvMode .pad{left:calc(var(--padX) * var(--tvS));top:calc(var(--padY) * var(--tvS));bottom:auto;width:calc(var(--padW) / var(--tvHudS));flex-wrap:wrap;transform:scale(calc(var(--tvS) * var(--tvHudS)));transform-origin:0 0}
/* The HUD is one 1920x1080 logical layer; relayout() places its slots from the layout. */
/* HUD type is TV.hudType via --tvH-* (logical px, all >= minHudFontPx): heavy weights, a
   dark plate behind every slot and a shadow under the text, so it holds up at 8-12 ft. */
.root.tvMode .tvHud{display:block;position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(var(--tvS));transform-origin:0 0;pointer-events:none;z-index:2;
 font-size:var(--tvH-line);color:#fff;line-height:1.1;text-shadow:0 2px 4px rgba(0,0,0,.55)}
.tvSlot{position:absolute;box-sizing:border-box;border-radius:28px;padding:16px 24px;background:rgba(6,18,40,.8);box-shadow:inset 0 0 0 3px rgba(255,255,255,.16);overflow:hidden}
.tvLabel{display:block;font-size:var(--tvH-label);font-weight:700;letter-spacing:.08em;color:#cfe2ff;text-transform:uppercase}
.tvBig{display:block;font-weight:700;font-size:var(--tvH-big);font-variant-numeric:tabular-nums;letter-spacing:.01em;text-shadow:0 3px 0 rgba(0,0,0,.35);white-space:nowrap}
.tvRound .tvBig{font-size:var(--tvH-roundBig)}
.tvRound .tvLine{white-space:normal}
.tvLine{display:block;margin-top:4px;font-weight:600;font-size:var(--tvH-line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tvLine:empty{display:none}
/* Warnings change shape and wording, not just hue: a ⚠ marker, and the alarm gets a solid plate. */
.tvWarn{color:#ffd35c}.tvWarn::before,.tvAlarm::before{content:'\\26a0\\00a0'}
.tvAlarm{color:#fff;background:#c2213a;border-radius:10px;padding:0 10px;display:inline-block;max-width:100%}
.tvChain{display:inline-block;margin-top:6px;padding:2px 14px;border-radius:999px;background:#6d4fd6;font-weight:700;font-size:var(--tvH-chain)}
.tvChain:empty{display:none}
.tvPower{padding:14px 20px}
.tvMeter{height:26px;border-radius:13px;background:rgba(255,255,255,.14);overflow:hidden;margin:8px 0 0}
.tvMeter i{display:block;height:100%;width:0;border-radius:13px;background:linear-gradient(90deg,#ff6fb1,#a78bfa)}
.tvPower.ready .tvMeter i{background:linear-gradient(90deg,#ff5b6b,#ffc233,#3ecf72,#3f9dff,#a78bfa)}
.tvInfo{background:rgba(9,26,54,.35);padding-top:88px}
.tvInfo:not(.calm){visibility:hidden}
.tvInfo .tvLine{font-size:var(--tvH-info);line-height:1.3;color:#e6f0ff;white-space:pre-line}
.tvCard{display:grid;grid-template-rows:auto 1fr auto;border-top:10px solid var(--accent,#fff)}
.tvName{display:flex;align-items:center;gap:14px;font-weight:700;font-size:var(--tvH-name);white-space:nowrap}
.tvName small{font-size:var(--tvH-tag);font-weight:700;color:#cfe2ff;letter-spacing:.06em;text-transform:uppercase}
.tvBalls{display:flex;align-items:center;gap:26px}
.tvBall{display:block;flex:none;border-radius:50%;background-size:106% 106%;background-position:center}
.tvBall.cur{width:118px;height:118px}.tvBall.next{width:66px;height:66px;opacity:.9}
.tvBallLabel{font-size:var(--tvH-tag);color:#cfe2ff;letter-spacing:.1em;text-transform:uppercase;font-weight:600}
.tvCard .tvStatus{font-weight:700;font-size:var(--tvH-status);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tvCard.small{padding-top:10px;padding-bottom:10px}.tvCard.small .tvBall.cur{width:64px;height:64px}.tvCard.small .tvBall.next{width:40px;height:40px}.tvCard.small .tvName{font-size:var(--tvH-nameSmall)}
/* Controller legend: bottom centre of the calibrated safe area, above every card and drawer. */
.root.tvMode .tvPrompts{display:flex;position:absolute;z-index:9;left:calc(var(--tvSafeX) * var(--tvS));width:calc(var(--tvSafeW) * var(--tvS));bottom:calc(var(--tvSafeB) * var(--tvS));
 justify-content:center;gap:.9em;pointer-events:none;font:700 calc(var(--tvH-prompt) * var(--tvS)) Fredoka,sans-serif;color:#fff}
.root.tvMode .tvPrompts[hidden]{display:none}
.tvPrompts>span{display:flex;align-items:center;gap:.35em;padding:.25em .6em;border-radius:999px;background:rgba(6,18,40,.88);box-shadow:0 0 0 2px rgba(255,255,255,.2);white-space:nowrap}
.tvKey{display:inline-grid;place-items:center;width:1.35em;height:1.35em;border-radius:50%;background:#fff;color:#0b1f3d;font-size:.9em;box-shadow:inset 0 0 0 4px var(--kc,#fff)}
.tvKey.kA{--kc:#3ecf72}.tvKey.kB{--kc:#ff5b6b}.tvKey.kX{--kc:#3f9dff}.tvKey.kY{--kc:#ffc233}
/* Controller connect / disconnect notice, top centre (inside the safe area on the TV stage). */
.padToast{position:absolute;z-index:9;left:50%;top:var(--chromeGap,10px);transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(6,18,40,.9);color:#fff;
 font:700 14px Fredoka,sans-serif;pointer-events:none;opacity:0;transition:opacity .25s;white-space:nowrap}
.padToast.on{opacity:1}
.root.tvMode .padToast{top:calc(var(--tvSafeY) * var(--tvS));left:calc((var(--tvSafeX) + var(--tvSafeW) / 2) * var(--tvS));font-size:calc(var(--tvH-toast) * var(--tvS));padding:calc(12px * var(--tvS)) calc(28px * var(--tvS))}
/* Screen Fit: the whole stage, darkened outside the calibrated safe rect, with bright corner
   marks on its corners. Everything is logical px on the 1920x1080 layer. */
.screenFit{display:none}
.root.tvMode .overlay.screenFit{padding:0;background:none;backdrop-filter:none;z-index:8}
.sfStage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(var(--tvS));transform-origin:0 0;font-family:Fredoka,sans-serif}
.sfFrame{position:absolute;left:var(--tvSafeX);top:var(--tvSafeY);width:var(--tvSafeW);height:var(--tvSafeH);box-sizing:border-box;border:4px dashed rgba(255,255,255,.75);
 box-shadow:0 0 0 2400px rgba(4,12,28,.72)}
.sfCorner{position:absolute;width:120px;height:120px;border:0 solid #ffc233;filter:drop-shadow(0 0 3px #000)}
.sfCorner.tl{left:-4px;top:-4px;border-width:14px 0 0 14px}.sfCorner.tr{right:-4px;top:-4px;border-width:14px 14px 0 0}
.sfCorner.bl{left:-4px;bottom:-4px;border-width:0 0 14px 14px}.sfCorner.br{right:-4px;bottom:-4px;border-width:0 14px 14px 0}
.sfEdge{position:absolute;padding:6px 16px;border-radius:12px;background:rgba(6,18,40,.9);color:#cfe2ff;font-weight:700;font-size:var(--tvH-label);white-space:nowrap;box-shadow:0 0 0 3px rgba(255,255,255,.2)}
.sfEdge.sel{background:#ffc233;color:#0b1f3d}
.sfEdge[data-e=top]{top:24px;left:50%;transform:translateX(-50%)}.sfEdge[data-e=bottom]{bottom:calc(var(--tvPromptH) + 12px);left:50%;transform:translateX(-50%)}
.sfEdge[data-e=left]{left:24px;top:50%;transform:translateY(-50%)}.sfEdge[data-e=right]{right:24px;top:50%;transform:translateY(-50%)}
.screenFit[data-edge=top] .sfFrame{border-top:10px solid #ffc233}.screenFit[data-edge=bottom] .sfFrame{border-bottom:10px solid #ffc233}
.screenFit[data-edge=left] .sfFrame{border-left:10px solid #ffc233}.screenFit[data-edge=right] .sfFrame{border-right:10px solid #ffc233}
.sfPanel{position:absolute;left:calc(var(--tvSafeX) + var(--tvSafeW) / 2);top:calc(var(--tvSafeY) + var(--tvSafeH) / 2);transform:translate(-50%,-50%);width:980px;box-sizing:border-box;
 padding:36px 44px;border-radius:32px;background:#fff;color:#17335c;text-align:center;font-size:var(--tvH-prompt);box-shadow:0 30px 80px rgba(0,0,0,.5)}
.sfPanel h1{margin:0 0 8px;font-size:calc(var(--tvM-title) * var(--tvMenuScale))}
.sfHelp{margin:0 0 24px;color:#3d5f86}
.sfEdges{justify-content:center;flex-wrap:wrap;gap:10px}
.sfPanel .seg button{font-size:var(--tvH-prompt);padding:8px 20px;border-radius:14px}
.sfAdjust{display:flex;align-items:center;justify-content:center;gap:20px;margin:26px 0 8px}
.sfStep{border:0;border-radius:16px;padding:12px 24px;font:700 var(--tvH-prompt) Fredoka,sans-serif;background:#eef5fd;color:#2b4a70;cursor:pointer}
.sfPanel input.sfRange{width:420px;height:40px}
.sfValue{font-weight:700;margin:6px 0 18px}
.sfActions{display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:16px}
.sfActions .btn{margin:0;font-size:calc(var(--tvM-button) * var(--tvMenuScale));padding:14px}
</style>
<div class="root">
  <div class="gameCol">
    <canvas></canvas>
    <button class="cornerButton fullscreenButton" type="button" title="Enter fullscreen" aria-label="Enter fullscreen"><span class="enterIcon" aria-hidden="true">\u26f6</span><span class="exitIcon" aria-hidden="true">\u2715</span></button>
    <button class="cornerButton gear" type="button" title="Settings" aria-label="Open settings">\u2699</button>
    <div class="onlineBar"><span class="onlineRoomLabel"></span><button class="onlinePause">Pause</button><button class="onlineRestart">Restart</button><button class="onlineLeave">Leave</button><span class="netState">Live</span></div>
    <div class="tvHud" aria-hidden="true">
      <div class="tvSlot tvScore"><span class="tvLabel">Team score</span><b class="tvBig tvScoreVal">0</b><span class="tvChain"></span></div>
      <div class="tvSlot tvRound"><span class="tvLabel tvRoundLabel">Round</span><b class="tvBig tvRoundVal"></b><span class="tvLine tvRoundName"></span><span class="tvLine tvPush"></span></div>
      <div class="tvSlot tvPower"><span class="tvLabel tvPowerLabel">Team power</span><div class="tvMeter"><i></i></div></div>
      <div class="tvSlot tvInfo"><span class="tvLabel">Match</span><span class="tvLine tvInfoText"></span></div>
      <div class="tvCards"></div>
    </div>
    <div class="buildTag">${BUILD_LABEL}</div>
    <div class="pad"><div class="padA" aria-hidden="true"></div><button class="padL">\u25c0</button><button class="padF">FIRE</button><button class="padR">\u25b6</button><button class="padP" aria-label="Pass bubble right">PASS ▶</button><button class="padPL" aria-label="Pass bubble left">◀ PASS</button><button class="padT" aria-label="Activate Team Power">TEAM POWER</button></div>
    <div class="overlay home"><div class="card">
      <h1>Bubble Together</h1><p class="sub">Play together on one device or live across different devices.</p>
      <label>Display name<input class="textInput playerName" maxlength="16" placeholder="Your name" autocomplete="nickname"></label>
      <div class="homeActions"><button class="btn primary createOnline">Create online room</button>
      <div class="joinFields"><button class="btn ghost joinOnline" style="margin:0">Join online room</button><input class="textInput roomInput" inputmode="numeric" maxlength="3" placeholder="123" aria-label="Room code" data-pad-chars="0123456789"></div>
      <div class="localCampaignButtons"><button class="btn ghost localPlay" data-tv-default>Original 52</button><button class="btn primary localCoopPlay">Bubble Together 2 · 52 co-op levels</button></div></div><div class="formError"></div>
      <div class="row displayRow"><span>Display</span><div class="seg dispSeg"><button data-d="auto">Auto</button><button data-d="desktop">Desktop</button><button data-d="tv">TV</button></div></div>
      <button class="btn primary tvOnly tvFullscreen">\u26f6 Play fullscreen</button>
      <button class="btn ghost tvOnly sfOpen">Screen Fit\u2026</button>
    </div></div>
    <div class="overlay padPick" style="display:none"><div class="card">
      <h1>Choose your side</h1><p class="sub">Press A / Cross on a controller to join, choose Left or Right, then press A / Cross again.</p>
      <div class="padPickSides"><div class="padPickSide" data-player="0"><b>LEFT</b><span>Open</span></div><div class="padPickSide" data-player="1"><b>RIGHT</b><span>Open</span></div></div>
      <div class="padPickStatus">Waiting for controllers…</div>
      <button class="btn ghost padPickSkip">Continue with keyboard / touch</button><button class="btn ghost padPickBack">Back</button>
    </div></div>
    <div class="overlay lobby" style="display:none"><div class="card lobbyCard">
      <h1>Online lobby</h1><p class="sub" style="margin-bottom:4px">Room code</p><div class="roomCode"></div>
      <div class="onlinePlayers"></div>
      <h3>Host settings</h3><div class="lobbySettings">
        <label>Campaign<select data-setting="campaign"><option value="original">Original 52</option><option value="coop2">Bubble Together 2</option></select></label>
        <label>Mode<select data-setting="mode"><option value="clear">Co-op Clear</option><option value="endless">Endless</option><option value="battle">Battle Royale (2\u20138)</option></select></label>
        <label>Field<select data-setting="field"><option value="classic">Classic</option><option value="wide">Wide 4×</option></select></label>
        <label>Level<select data-setting="level">${levelOptionsHTML()}</select></label>
        <label>Aim guide<select data-setting="guide"><option value="1">Full path</option><option value="0.5">Short</option><option value="0.25">Tiny</option></select></label>
        <label>Reload<input data-setting="reload" type="range" min="0.8" max="2.2" step="0.05"></label>
        <label>Miss limit<input data-setting="missMax" type="range" min="4" max="20" step="1"></label>
        <label>Shot pressure<input data-setting="pressureShots" type="range" min="0" max="20" step="1"></label>
        <label>Hurry-up (s)<input data-setting="hurry" type="range" min="0" max="20" step="1"></label>
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
      <h1>Paused</h1><p class="sub pauseSub">press P or the button to resume</p>
      <button class="btn primary resume">Resume</button>
      <button class="btn ghost tvOnly tvFullscreen">\u26f6 Fullscreen</button>
      <button class="btn ghost tvOnly sfOpen">Screen Fit\u2026</button>
      <div class="row displayRow"><span>Display</span><div class="seg dispSeg"><button data-d="auto">Auto</button><button data-d="desktop">Desktop</button><button data-d="tv">TV</button></div></div>
    </div></div>
    <div class="overlay levelUp" style="display:none"><div class="card">
      <h1 class="luTitle"></h1><p class="sub luSub"></p><p class="luTime"></p>
      <div class="luStats"></div>
      <div class="luReady"></div>
      <button class="btn primary luNext">Continue</button>
    </div></div>
    <div class="overlay end" style="display:none"><div class="card">
      <h1 class="endTitle"></h1><p class="sub endSub"></p>
      <div class="endStats"></div>
      <div class="hiscore" style="display:none">
        <h3 class="hsTitle">High scores</h3>
        <div class="hsEntry" style="display:none">
          <span class="hsPrompt">New high score! Enter your initials</span>
          <div class="hsSlots"><input class="hsIn" maxlength="3" autocomplete="off" spellcheck="false" aria-label="Initials" data-pad-chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"><button class="btn primary hsSave">Save</button></div>
        </div>
        <div class="hsList"></div>
        <div class="hsNote"></div>
      </div>
      <button class="btn primary again">Play again</button>
    </div></div>
    <div class="overlay screenFit" style="display:none"><div class="sfStage">
      <div class="sfFrame"><i class="sfCorner tl"></i><i class="sfCorner tr"></i><i class="sfCorner bl"></i><i class="sfCorner br"></i>
        <span class="sfEdge" data-e="top"></span><span class="sfEdge" data-e="right"></span><span class="sfEdge" data-e="bottom"></span><span class="sfEdge" data-e="left"></span></div>
      <div class="sfPanel" role="dialog" aria-label="Screen Fit">
        <h1>Screen Fit</h1>
        <p class="sfHelp">Move the edges until all four corner marks are fully visible on your TV.</p>
        <div class="seg sfEdges"><button data-e="all">All edges</button><button data-e="top">Top</button><button data-e="right">Right</button><button data-e="bottom">Bottom</button><button data-e="left">Left</button></div>
        <div class="sfAdjust"><button class="sfStep" data-d="-1" aria-label="Move edge out">\u25c0 Out</button><input type="range" class="sfRange" aria-label="Edge inset"><button class="sfStep" data-d="1" aria-label="Move edge in">In \u25b6</button></div>
        <div class="sfValue"></div>
        <div class="sfActions"><button class="btn ghost sfReset">Reset</button><button class="btn ghost sfCancel">Cancel</button><button class="btn primary sfSave">Save</button></div>
      </div>
    </div></div>
    <div class="overlay tvSmall" role="dialog" aria-label="Window too small for TV mode">
      <div class="card tvSmallCard">
        <h2>Window too small for TV mode</h2>
        <p>Enlarge to at least 960 × 540 or go fullscreen</p>
        <div class="tvSmallActions">
          <button class="btn primary tvSmallFs tvFullscreen" data-tv-default>Fullscreen</button>
          <button class="btn ghost tvSmallDesktop">Use Desktop layout</button>
        </div>
      </div>
    </div>
    <div class="tvPrompts tvOnly" hidden></div>
    <div class="padToast" role="status" aria-live="polite"></div>
  </div>
  <div class="side"></div>
  <pre class="perfHud" aria-hidden="true"></pre>
</div>`;
    this.canvas = sh.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.rootEl = sh.querySelector('.root');
    this.gameColEl = sh.querySelector('.gameCol');
    this.tutEl = sh.querySelector('.tutorial');
    this.homeEl = sh.querySelector('.home');
    this.padPickEl = sh.querySelector('.padPick');
    this.lobbyEl = sh.querySelector('.lobby');
    this.reconnectEl = sh.querySelector('.reconnect');
    this.pauseEl = sh.querySelector('.pause');
    this.perfEl = sh.querySelector('.perfHud');
    this.endEl = sh.querySelector('.end');
    this.levelUpEl = sh.querySelector('.levelUp');
    this.sideEl = sh.querySelector('.side');
    this.screenFitEl = sh.querySelector('.screenFit');
    this.tvSmallEl = sh.querySelector('.tvSmall');
    this.promptsEl = sh.querySelector('.tvPrompts');
    this.toastEl = sh.querySelector('.padToast');
    this.applyTouchStyle();
    sh.querySelector('.localPlay').onclick = () => this.beginLocalPlay('original');
    sh.querySelector('.localCoopPlay').onclick = () => this.beginLocalPlay('coop2');
    sh.querySelector('.padPickSkip').onclick = () => this.finishPadPick(true);
    sh.querySelector('.padPickBack').onclick = () => this.cancelPadPick();
    sh.querySelector('.createOnline').onclick = () => { this.tvFullscreenNudge(); this.beginOnline('create'); };
    sh.querySelector('.joinOnline').onclick = () => { this.tvFullscreenNudge(); this.beginOnline('join'); };
    sh.querySelector('.roomInput').addEventListener('input', e => e.target.value=e.target.value.replace(/\D/g,'').slice(0,3));
    sh.querySelector('.start').onclick = () => { this.tvFullscreenNudge(); this.ensureAudio(); if (this.settings.mode === 'battle' && !this.battle) this.resetGame(); this.state = 'play'; this._t = performance.now(); this.tutEl.style.display = 'none'; };
    sh.querySelector('.resume').onclick = () => this.togglePause();
    sh.querySelector('.again').onclick = () => { if(this.online){if(this.isOnlineHost())this.sendOnline('return_to_lobby');}else{
      // A finished level chain leaves settings.level on the last level; restart the run.
      if (this._runStartLevel !== undefined) { this.settings.level = this._runStartLevel; this.settings.campaign=this._runStartCampaign||this.settings.campaign||'original'; this._syncSettings?.(); }
      this.state = 'play'; this.resetGame(); } };
    sh.querySelector('.luNext').onclick = () => this.readyForNextLevel();
    sh.querySelector('.gear').onclick = () => this.sideEl.classList.toggle('open');
    sh.querySelector('.tvSmallDesktop').onclick = () => this.setDisplayMode('desktop');
    const fullscreenButton = sh.querySelector('.fullscreenButton');
    this.fullscreenButtonEl = fullscreenButton;
    this.gearEl = sh.querySelector('.gear');
    const syncFullscreenButton = () => {
      const active = this.isFullscreen();
      /* Leaving fullscreen never leaves TV mode — Display is its own setting. It only stops
         the TV flows from asking again this session: the player chose the window. */
      if (this._wasFullscreen && !active) this._fsDeclined = true;
      this._wasFullscreen = active;
      fullscreenButton.classList.toggle('isFullscreen', active);
      this.rootEl.classList.toggle('isFullscreen', active);
      fullscreenButton.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
      fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
      this.measure();
    };
    this._syncFullscreen = syncFullscreenButton;
    fullscreenButton.onclick = () => this.toggleFullscreen();
    sh.querySelectorAll('.tvFullscreen').forEach(b => { b.onclick = () => { this._fsDeclined = false; this.enterFullscreen(); }; });
    sh.querySelectorAll('.card .dispSeg button').forEach(b => { b.onclick = () => this.setDisplayMode(b.dataset.d); });
    sh.querySelectorAll('.card .sfOpen').forEach(b => { b.onclick = () => this.openScreenFit(); });
    this.bindScreenFit();
    document.addEventListener('fullscreenchange', syncFullscreenButton);
    document.addEventListener('webkitfullscreenchange', syncFullscreenButton);
    this._fullscreenUnbind = () => {
      document.removeEventListener('fullscreenchange', syncFullscreenButton);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenButton);
    };
    if (!(this.requestFullscreen || this.webkitRequestFullscreen)) {
      fullscreenButton.hidden = true; sh.querySelectorAll('.tvFullscreen').forEach(b => { b.hidden = true; });
    }
    syncFullscreenButton();
    /* One capture-phase router owns every touch on the pad, so which control wins is a
       property of padHit's order rather than of CSS stacking. The aim halves are transparent
       full-height overlays, so before this a thumb landing a few pixels off FIRE turned the
       launcher instead of shooting — the commonest mis-hit on a phone. */
    const pad = this.padEl = sh.querySelector('.pad');
    this.passBtn = sh.querySelector('.padP');
    this.passLeftBtn = sh.querySelector('.padPL');
    this.powerBtn = sh.querySelector('.padT');
    pad.addEventListener('pointerdown', e => {
      const hit = this.padHit(e.clientX, e.clientY); if (!hit) return;
      e.preventDefault(); e.stopPropagation(); this.ensureAudio();
      /* Capture on the control that was actually hit, never on .pad: the pad is
         pointer-events:none on touch layouts, and capturing to it makes the browser drop the
         pointer with a cancel on the first move — which killed every aim drag one frame in.
         Touch pointers are implicitly captured to their target anyway, so this is really for
         mouse and pen; either way the listeners below are ancestors of the capture target. */
      try { if (e.target && e.target !== pad) e.target.setPointerCapture(e.pointerId); } catch (_) {}
      const hold = this._padHold = { id: e.pointerId, hit, p: null };
      if (hit === 'fire') this.padFire();
      else if (hit === 'pass') this.padPass(1);
      else if (hit === 'passLeft') this.padPass(-1);
      else if (hit === 'power') this.padTeamPower();
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
    this.setupDprListener();
    this.measure();
    this.buildSettings();
  }
  setupDprListener() {
    let dprMq = null;
    const onDprChange = () => {
      this.fit();
      armDpr();
    };
    const armDpr = () => {
      if (dprMq) {
        if (dprMq.removeEventListener) dprMq.removeEventListener('change', onDprChange);
        else if (dprMq.removeListener) dprMq.removeListener(onDprChange);
      }
      const dpr = window.devicePixelRatio || 1;
      dprMq = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${dpr}dppx)`) : null;
      if (dprMq) {
        if (dprMq.addEventListener) dprMq.addEventListener('change', onDprChange);
        else if (dprMq.addListener) dprMq.addListener(onDprChange);
      }
    };
    armDpr();
    this._dprUnbind = () => {
      if (dprMq) {
        if (dprMq.removeEventListener) dprMq.removeEventListener('change', onDprChange);
        else if (dprMq.removeListener) dprMq.removeListener(onDprChange);
      }
      dprMq = null;
    };
  }

  /* ---------- layout ---------- */
  /* Available space picks the world height; the world height sets the CSS aspect ratio.
     Offline that chain runs live; online the room's viewH wins so every player shares
     one danger line, and a mismatched device simply letterboxes. */
  measure() {
    const root = this.rootEl; if (!root) return;
    this._laidVW = this.VW;
    const wasTv = !!this.tvActive;
    const isTv = this.syncDisplayMode();
    const flipped = wasTv !== isTv;
    if (flipped && !this.online && this.state !== 'home') this._geoLocked = true;
    /* TV places everything on the fixed logical stage, so the world height is the one its
       layout was drawn for rather than whatever shape the window happens to be. */
    if (isTv) {
      this._deviceViewH = H0;
      if (!this.online && !this._geoLocked) this.setViewH(H0);
      this.relayout();
      return;
    }
    const cs = getComputedStyle(root);
    const availW = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = root.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (!(availW > 0 && availH > 0)) return;
    this._avail = { w: availW, h: availH,
      sideW: parseFloat(cs.getPropertyValue('--sideW')) || 290,
      gap: parseFloat(cs.getPropertyValue('--rootGap')) || 20 };
    this._deviceViewH = geom(this.VW * availH / availW).H;
    if (!this.online && !this._geoLocked) this.setViewH(this._deviceViewH);
    this.relayout();
  }
  relayout() {
    const root = this.rootEl, col = this.gameColEl, a = this._avail;
    if (root && col && this.tvActive) { this.relayoutTv(); return; }
    if (!root || !col || !a) return;
    root.style.setProperty('--fieldAspect', (this.VW / this.H).toFixed(5));
    /* One pass, no oscillation. Decide on the side panel from the board as it would be
       with no panel; because the panel only appears with 300px+ to spare, the board is
       already height-limited by then, so reserving the panel cannot shrink it and flip
       the decision back. Wide and near-square screens — phone landscape, an unfolded
       Fold — spend that space on UI instead of empty gradient. */
    const wide = a.w - Math.min(a.w, a.h * this.VW / this.H) >= 300;
    root.classList.toggle('wideLayout', wide);
    const usableW = wide ? a.w - a.sideW - a.gap : a.w;
    const boardW = Math.max(1, Math.min(usableW, a.h * this.VW / this.H));
    col.style.width = boardW + 'px';
    col.style.height = boardW * this.H / this.VW + 'px';
    this.fit();
  }
  fit() {
    const el = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth || 320;
    el.width = Math.round(w * dpr); el.height = Math.round(w * dpr * this.H / this.VW);
    /* One unit of "board scale" so overlay chrome can track the board instead of the
       page — a 44px button is huge on a 344px cover screen and lost on a 900px one. */
    this.gameColEl?.style.setProperty('--u', (w / this.VW).toFixed(4));
    /* The corner buttons are DOM overlays with a minimum tap size, so on a narrow board
       they cover more of the world than their nominal 44px. Measure one of them and let
       the canvas HUD inset itself to match rather than being drawn underneath. */
    const btn = [this.fullscreenButtonEl, this.gearEl].find(el => el && el.offsetWidth > 0);
    const gap = btn ? Math.min(btn.offsetLeft, w - btn.offsetLeft - btn.offsetWidth) : 0;
    // On the TV stage the corner buttons sit in the safe corners, well clear of the field.
    this.chromeInset = btn && !this.tvActive ? Math.max(X0, (btn.offsetWidth + gap * 2) * this.VW / w) : X0;
  }

  /* ---------- TV / couch display ---------- */
  /* Resolves Auto / Desktop / TV against this screen and flips .tvMode. Auto is re-asked on
     every measure and whenever a gamepad comes or goes, so it follows the room it is in. */
  syncDisplayMode() {
    const root = this.rootEl; if (!root) return false;
    const mm = q => typeof matchMedia === 'function' && matchMedia(q).matches;
    const tv = resolveDisplayMode(this.settings.displayMode, {
      w: root.clientWidth, h: root.clientHeight,
      gamepad: this.connectedPads().length > 0, noPointer: mm('(any-pointer: none)'),
      current: this.tvActive ? 'tv' : 'desktop' }) === 'tv';
    if (tv !== !!this.tvActive) {
      this.tvActive = tv; this.tvLay = null;
      root.classList.toggle('tvMode', tv);
      if (!tv && typeof this.closeScreenFit === 'function') this.closeScreenFit(false); // calibration is a TV screen; leaving TV cancels it
    }
    if (!tv) {
      this._tvTooSmall = false;
      root.classList.remove('tvTooSmall');
    }
    return tv;
  }
  setDisplayMode(m) {
    if (!DISPLAY_MODES.includes(m)) return;
    this.settings.displayMode = m; this.saveLocalPrefs();
    this.measure(); this.syncDisplaySegs();
    // Choosing TV is a click, which is exactly the gesture a fullscreen request needs.
    if (m === 'tv') { this._fsDeclined = false; this.tvFullscreenNudge(); }
  }
  syncDisplaySegs() {
    this.shadowRoot?.querySelectorAll('.dispSeg button').forEach(b => b.classList.toggle('on', b.dataset.d === this.settings.displayMode));
  }
  isFullscreen() { return (document.fullscreenElement || document.webkitFullscreenElement) === this; }
  async enterFullscreen() {
    if (this.isFullscreen()) return;
    const enter = this.requestFullscreen || this.webkitRequestFullscreen;
    try { if (enter) await enter.call(this); } catch (_) { this._fsDeclined = true; }
    this._syncFullscreen && this._syncFullscreen();
  }
  async toggleFullscreen() {
    if (!this.isFullscreen()) { this._fsDeclined = false; return this.enterFullscreen(); }
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try { if (exit) await exit.call(document); } catch (_) {}
    this._syncFullscreen && this._syncFullscreen();
  }
  /* TV prefers fullscreen, so the clicks that start play ask for it — once. A refusal, an
     unsupported browser or the player backing out of fullscreen all leave TV mode running in
     the window, and nothing asks again until they press a fullscreen button themselves. */
  tvFullscreenNudge() {
    if (this.tvActive && TV.preferFullscreen && !this._fsDeclined && !this.isFullscreen()) this.enterFullscreen();
  }
  tvPlayerCount() {
    return this.online || this.settings.mode !== 'battle' ? ((this.players || []).length || this.settings.players) : this.settings.players;
  }
  // The Screen Fit in force: the draft while the calibration screen is open, else the saved one.
  screenFitNow() { return this._fitDraft || this.settings.screenFit || TV.screenFit; }
  tvApplyStage() {
    const root = this.rootEl, col = this.gameColEl, fit = this.screenFitNow();
    if (!root || !col) return;
    const vw = root.clientWidth || TV.logicalW, vh = root.clientHeight || TV.logicalH;
    const tooSmall = tvTooSmall(vw, vh, TV);
    if (tooSmall !== !!this._tvTooSmall) {
      this._tvTooSmall = tooSmall;
      if (tooSmall) {
        this.closeScreenFit(false);
        if (!this.online && this.state === 'play') this.togglePause();
      }
    }
    root.classList.toggle('tvTooSmall', tooSmall);
    const stageW = tooSmall ? Math.max(vw, TV.minViewport.w) : vw;
    const stageH = tooSmall ? Math.max(vh, TV.minViewport.h) : vh;
    const st = tvStage(stageW, stageH, TV, fit);
    st.x = (vw - st.w) / 2;
    st.y = (vh - st.h) / 2;
    root.classList.remove('wideLayout');
    col.style.width = st.w + 'px';
    col.style.height = st.h + 'px';
    const set = (k, v) => root.style.setProperty(k, String(v));
    set('--tvS', st.scale.toFixed(5));
    set('--tvX', st.x.toFixed(1) + 'px');
    set('--tvY', st.y.toFixed(1) + 'px');
    set('--tvMenuK', (st.scale * TV.menuScale).toFixed(5));
    this.fit();
  }
  tvRebuildLayout() {
    const root = this.rootEl, fit = this.screenFitNow();
    if (!root) return;
    const n = this.tvPlayerCount(), key = tvLayoutKey(this.settings.mode, n);
    const lay = this.tvLay = tvLayout(key, this.VW / this.H, n, TV, fit);
    lay.n = n; lay.H = this.H; lay.VW = this.VW; lay.fit = JSON.stringify(fit);
    const set = (k, v) => root.style.setProperty(k, String(v));
    set('--tvHudS', TV.hudScale);
    set('--tvMenuScale', TV.menuScale);
    const sf = lay.safe;
    set('--tvSafeX', sf.x + 'px'); set('--tvSafeY', sf.y + 'px'); set('--tvSafeW', sf.w + 'px'); set('--tvSafeH', sf.h + 'px');
    set('--tvSafeR', (TV.logicalW - sf.x - sf.w) + 'px'); set('--tvSafeB', (TV.logicalH - sf.y - sf.h) + 'px');
    set('--tvChrome', TV.chrome + 'px'); set('--tvPromptH', TV.promptH + 'px');
    // Couch type: HUD sizes are logical px; menu sizes are divided by menuScale because the
    // cards are scaled by it, so what reaches the screen is exactly the table's value.
    for (const [k, v] of Object.entries(TV.hudType)) set('--tvH-' + k, Math.max(TV.minHudFontPx, v) + 'px');
    for (const [k, v] of Object.entries(TV.menuType)) set('--tvM-' + k, (Math.max(TV.minMenuFontPx, v) / TV.menuScale).toFixed(2) + 'px');
    for (const [name, r] of [['pf', lay.playfield], ['pad', lay.pad], ['info', lay.info]]) {
      set(`--${name}X`, r.x.toFixed(1) + 'px'); set(`--${name}Y`, r.y.toFixed(1) + 'px');
      set(`--${name}W`, r.w.toFixed(1) + 'px'); set(`--${name}H`, r.h.toFixed(1) + 'px');
    }
    this.placeTvHud(lay);
  }
  tvNeedsRebuild() {
    const lay = this.tvLay, n = this.tvPlayerCount();
    return !lay || lay.n !== n || lay.H !== this.H || lay.VW !== this.VW || lay.key !== tvLayoutKey(this.settings.mode, n)
      || lay.fit !== JSON.stringify(this.screenFitNow());
  }
  relayoutTv(forceRebuild = false) {
    if (forceRebuild || this.tvNeedsRebuild()) {
      this.tvRebuildLayout();
    }
    this.tvApplyStage();
  }
  placeTvHud(lay) {
    const sh = this.shadowRoot, place = (el, r) => {
      if (!el) return; el.style.display = r ? '' : 'none';
      if (r) Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    };
    place(sh.querySelector('.tvScore'), lay.hud && lay.score);
    place(sh.querySelector('.tvRound'), lay.hud && lay.round);
    /* The wide two-player board leaves narrower columns: the round slot wraps and grows
       downward (into the empty info column) rather than cutting off the row-push warning. */
    const round = sh.querySelector('.tvRound');
    if (round && lay.hud && lay.round) Object.assign(round.style, { height: 'auto', minHeight: lay.round.h + 'px' });
    place(sh.querySelector('.tvPower'), lay.hud && lay.power);
    place(sh.querySelector('.tvInfo'), lay.hud && lay.info);
    const box = sh.querySelector('.tvCards');
    box.innerHTML = '';
    this.tvCards = lay.cards.map((r, i) => {
      const meta = META[i], el = document.createElement('div');
      el.className = 'tvSlot tvCard' + (r.h < 240 ? ' small' : '');
      el.style.setProperty('--accent', meta.accent);
      el.innerHTML = `<div class="tvName"><span class="tvWho"></span><small class="tvTag"></small></div>
        <div class="tvBalls"><span class="tvBall cur"></span><span><span class="tvBall next"></span><span class="tvBallLabel">next</span></span></div>
        <div class="tvStatus"></div>`;
      place(el, r); box.appendChild(el);
      return { el, who: el.querySelector('.tvWho'), tag: el.querySelector('.tvTag'), cur: el.querySelector('.cur'),
        next: el.querySelector('.next'), status: el.querySelector('.tvStatus') };
    });
    this._tvCache = new Map();
  }
  // The loaded / next bubble as a DOM swatch: the same sprite the canvas draws, colour behind it.
  tvBallStyle(b) {
    if (!b) return 'visibility:hidden';
    const sp = b.special === 'rainbow' || b.special === 'bomb' ? b.special : b.kind;
    const bg = PAL[b.kind] || '#c9d6e6', src = BUBBLE_SPRITE_URLS[sp];
    return `visibility:visible;background-color:${bg};` + (src ? `background-image:url(${src})` : '');
  }
  /* Per-frame HUD sync. Values are cached per node, so an unchanged frame touches no DOM.
     Active play shows only what matters this second; the match details wait for a pause,
     a round card or the end screen (TV.hideSecondaryHud). */
  syncTvHud() {
    if (!this.tvActive) return;
    if (this.tvNeedsRebuild()) { this.relayoutTv(true); return; }
    if (!this.tvLay || !this.tvLay.hud) return;
    const sh = this.shadowRoot, cache = this._tvCache || (this._tvCache = new Map());
    const put = (el, prop, v) => { const k = cache.get(el) || {}; if (k[prop] === v) return; k[prop] = v; cache.set(el, k);
      if (prop === 'text') el.textContent = v; else if (prop === 'class') el.className = v; else if (prop === 'css') el.style.cssText = v; else el.style.setProperty(prop, v); };
    put(sh.querySelector('.tvScoreVal'), 'text', Math.round(this.dispScore || 0).toLocaleString());
    put(sh.querySelector('.tvChain'), 'text', this.chain && this.chain.mult > 1 ? 'CHAIN \u00d7' + this.chain.mult + '  ' + this.teamHumans().map(i => (this.chain.players.has(i) ? '\u25cf' : '\u25cb') + 'P' + (i + 1)).join(' ') : '');
    const S = this.settings, idx = this.levelIndex();
    put(sh.querySelector('.tvRoundLabel'), 'text', S.mode === 'clear' ? (idx >= 0 ? 'Round ' + (idx + 1) + ' of ' + LEVELS.length : 'Custom round') : 'Endless');
    put(sh.querySelector('.tvRoundVal'), 'text', S.mode === 'clear' ? (idx >= 0 ? String(idx + 1) : 'Custom') : 'Survive');
    put(sh.querySelector('.tvRoundName'), 'text', S.mode === 'clear' && idx >= 0 ? this.roundName(idx) : 'together');
    const left = this.dropCountdown(), held = this.teamPowerActive && powerHolds(this.teamPowerActive, 'holdPressure');
    const push = sh.querySelector('.tvPush');
    put(push, 'text', left === null ? '' : held ? 'Row push held' : 'Row push in ' + left + (left === 1 ? ' shot' : ' shots'));
    put(push, 'class', 'tvLine tvPush' + (left !== null && !held && left <= 1 ? ' tvAlarm' : left !== null && !held && left <= 3 ? ' tvWarn' : ''));
    // Team Power: one slot for the shared roster.
    const power = sh.querySelector('.tvPower'), duo = this.teamHumans().length >= 2;
    put(power, 'visibility', duo ? 'visible' : 'hidden');
    if (duo) {
      const max = TEAM_POWER.max, charge = this.teamPowerCharge || 0, active = this.teamPowerActive, def = active ? POWERS[active] : null;
      const ready = !active && charge >= max, frac = def ? clamp((this.teamPowerTimer || 0) / def.secs, 0, 1) : clamp(charge / max, 0, 1);
      put(power, 'class', 'tvSlot tvPower' + (ready || active ? ' ready' : ''));
      put(sh.querySelector('.tvPowerLabel'), 'text', def ? def.name + ' ' + Math.max(0, this.teamPowerTimer || 0).toFixed(1) + 's'
        : ready ? 'Team power ready \u00b7 Q / Y' : 'Team power ' + Math.floor(charge) + '%');
      put(sh.querySelector('.tvMeter i'), 'width', (frac * 100).toFixed(1) + '%');
    }
    // Secondary details: only once play stops.
    const calm = !TV.hideSecondaryHud || this.state !== 'play';
    const info = sh.querySelector('.tvInfo');
    put(info, 'class', 'tvSlot tvInfo' + (calm ? ' calm' : ''));
    if (calm) put(sh.querySelector('.tvInfoText'), 'text', [
      'Miss meter ' + Math.floor(this.missMeter || 0) + ' / ' + this.missLimit(),
      'Shot pressure ' + (S.pressureShots ? S.pressureShots + ' shots' : 'off') + ' \u00b7 hurry-up ' + (S.hurry ? S.hurry + 's' : 'off'),
      'Reload ' + Number(S.reload).toFixed(2) + 's \u00b7 aim guide ' + (S.guide === 1 ? 'full' : S.guide === 0.5 ? 'short' : 'tiny'),
      'Controllers ' + this.connectedPads().length + ' \u00b7 A fires \u00b7 LB/RB pass left/right \u00b7 Y power · B bomb',
    ].join('\n'));
    // Player cards: who, what is loaded, what is next, and one line of status.
    const limit = Number(S.hurry) || 0;
    (this.tvCards || []).forEach((c, i) => {
      const p = (this.players || [])[i];
      put(c.el, 'visibility', p ? 'visible' : 'hidden'); if (!p) return;
      put(c.who, 'text', p.name || (p.meta || META[i]).name);
      put(c.tag, 'text', this.settings.mode === 'clear' && this.players.length >= 2 ? '💣 ×' + (p.bombs || 0) + (p.bombLoaded ? ' +1 loaded' : ' · B bomb') : p.bot ? 'bot' : this.online && i === this.activeP ? 'you' : this.padOwner(i) ? 'controller' : '');
      const loading = this.passFx && (i === this.passFx.a || i === this.passFx.b) && (this.now - this.passFx.t) < PASS_FX;
      put(c.cur, 'css', this.tvBallStyle(loading ? null : p.cur));
      put(c.next, 'css', this.tvBallStyle(p.next));
      const hurry = limit && this.state === 'play' && !p.bot && p.idle > limit - PACE.hurryWarn;
      const st = hurry ? 'HURRY UP! ' + Math.ceil(Math.max(0, limit - p.idle))
        : calm ? `${p.stats?.shots || 0} shots \u00b7 ${p.stats?.pops || 0} pops \u00b7 ${p.stats?.assists || 0} setups`
        : p.reload > 0 ? 'Reloading\u2026' : 'Ready';
      put(c.status, 'text', this.chain?.players?.has(i) && this.chain.t > 0 ? '\u25cf CHAIN \u00b7 ' + st : st);
      put(c.status, 'class', 'tvStatus' + (hurry ? ' tvAlarm' : ''));
    });
  }
  hideOverlays() { this._outro = null; this.pauseEl.style.display = 'none'; this.endEl.style.display = 'none'; this.levelUpEl.style.display = 'none'; }
  showEnd(won) {
    const sh = this.shadowRoot;
    sh.querySelector('.endTitle').textContent = won ? '\u2b50 Field cleared!' : 'The bubbles won\u2026';
    sh.querySelector('.endTitle').style.color = won ? '#2b6fd4' : '#ff5b6b';
    sh.querySelector('.endSub').textContent = 'Team score: ' + this.score.toLocaleString();
    sh.querySelector('.endStats').innerHTML = this.statRowsHTML(this.playerStatRows(this.players));
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
    return { mode, level: mode === 'clear' ? (this._runStartLevel ?? this.settings.level) : 0,
      campaign: mode === 'clear' ? (this._runStartCampaign || this.settings.campaign || 'original') : 'original' };
  }
  async showHighScores(score) {
    const sh = this.shadowRoot, wrap = sh.querySelector('.hiscore');
    const entryEl = sh.querySelector('.hsEntry'), listEl = sh.querySelector('.hsList'), noteEl = sh.querySelector('.hsNote');
    wrap.style.display = ''; entryEl.style.display = 'none'; noteEl.textContent = '';
    listEl.innerHTML = '<div class="hsNote">Loading…</div>';
    const bucket = this.scoreBucket();
    let entries;
    try {
      const res = await fetch(`/scores?mode=${encodeURIComponent(bucket.mode)}&level=${encodeURIComponent(bucket.level)}&campaign=${encodeURIComponent(bucket.campaign)}`, { cache:'no-store' });
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
          body: JSON.stringify({ initials, score, mode: bucket.mode, level: bucket.level, campaign: bucket.campaign }) });
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
    this.ensureAudio();this.online=true;this.syncSideScope();this._pendingOnline={action,name,code};this.openOnlineSocket();
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
      this.syncSideScope();this.homeEl.style.display='none';if(msg.snapshot){this.lobbyEl.style.display='none';this._runStartLevel=msg.snapshot?.settings?.level??0;this._runStartCampaign=msg.snapshot?.settings?.campaign||'original';this.applyOnlineSnapshot(msg.snapshot);}else this.showOnlineLobby();return;
    }
    if(msg.type==='lobby_state'){this.onlineRoom=msg.room;if(msg.room.phase==='lobby')this.showOnlineLobby();return;}
    if(msg.type==='host_changed'){if(this.onlineRoom)this.onlineRoom.hostId=msg.hostId;this.syncOnlineControls();return;}
    if(msg.type==='match_started'){this.onlineRoom=msg.room;this.lobbyEl.style.display='none';this.endEl.style.display='none';
      // Snapshots overwrite settings.level as the server walks the chain, so pin the
      // level this run started on for the leaderboard bucket.
      this._runStartLevel=msg.snapshot?.settings?.level??0;this._runStartCampaign=msg.snapshot?.settings?.campaign||'original';this.applyOnlineSnapshot(msg.snapshot);this.shadowRoot.querySelector('.onlineBar').style.display='flex';return;}
    if(msg.type==='snapshot'){if(msg.phase==='ended'&&this.onlineRoom)this.onlineRoom.phase='ended';this.applyOnlineSnapshot(msg.snapshot);return;}
    if(msg.type==='phase_changed'){this.state=msg.phase;this.pauseEl.style.display=msg.phase==='paused'?'grid':'none';this.syncOnlineControls();return;}
    if(msg.type==='left'){this.returnHome();}
  }
  showOnlineLobby(){
    const sh=this.shadowRoot,room=this.onlineRoom;if(!room)return;this.state='lobby';this.homeEl.style.display='none';this.tutEl.style.display='none';this.endEl.style.display='none';this.pauseEl.style.display='none';this.reconnectEl.style.display='none';this.lobbyEl.style.display='grid';sh.querySelector('.onlineBar').style.display='none';
    sh.querySelector('.roomCode').textContent=room.code;sh.querySelector('.onlinePlayers').innerHTML=room.players.map((p,i)=>`<div class="onlinePlayer"><span class="pDot" style="background:${META[i].accent}"></span><span>${this.escapeHTML(p.name)}</span><span class="statusDot ${p.connected?'':'off'}"></span>${p.id===room.hostId?'<span class="hostTag">HOST</span>':''}</div>`).join('');
    const host=this.isOnlineHost(),settings=room.settings,battle=settings.mode==='battle',campaign=settings.campaign||'original';
    const lobbyLevel=sh.querySelector('.lobbySettings [data-setting="level"]');
    if(lobbyLevel.dataset.campaign!==campaign){lobbyLevel.innerHTML=levelOptionsHTML(campaign);lobbyLevel.dataset.campaign=campaign;}
    sh.querySelectorAll('.lobbySettings [data-setting]').forEach(el=>{const k=el.dataset.setting,v=settings[k];el.disabled=!host;el.value=typeof v==='boolean'?String(v):String(v??'');if(['field','mateLines'].includes(k))el.closest('label').style.display=battle?'none':'';});
    if(campaign==='coop2'){sh.querySelector('.lobbySettings [data-setting="mode"]').disabled=true;sh.querySelector('.lobbySettings [data-setting="field"]').disabled=true;}
    /* The host's screen shape is a room setting, so publish it on arrival — otherwise a
       host who never touches a slider would silently hand everyone the 1080 default. */
    if(host&&room.phase==='lobby'&&this._deviceViewH&&settings.viewH!==this._deviceViewH)this.pushLobbySettings();
    sh.querySelector('.customSetting').style.display=settings.level==='custom'?'grid':'none';const start=sh.querySelector('.lobbyStart');start.style.display=host?'block':'none';start.disabled=room.players.filter(p=>p.connected).length<2;sh.querySelector('.lobbyError').textContent=host?'':'Waiting for the host to start.';
  }
  pushLobbySettings(){
    if(!this.isOnlineHost()||!this.onlineRoom)return;const next={...this.onlineRoom.settings};this.shadowRoot.querySelectorAll('.lobbySettings [data-setting]').forEach(el=>{let v=el.value;if(['reload','missMax','rescueDur','assist','pressureShots','hurry','guide','aimSpeed','padTint','fireScale'].includes(el.dataset.setting))v=Number(v);if(['mateLines','sound'].includes(el.dataset.setting))v=v==='true';if(el.dataset.setting==='level'&&v!=='custom')v=Number(v);next[el.dataset.setting]=v;});
    if(next.campaign==='coop2'){next.mode='clear';next.field='classic';if(next.level==='custom'||!Number.isInteger(next.level))next.level=0;}
    if(next.mode==='battle')next.campaign='original';next.viewH=this._deviceViewH||H0;this.sendOnline('update_settings',{revision:this.onlineRoom.revision,settings:next});
  }
  /* Rebuild a launcher from a snapshot without stamping on the angle we are already showing:
     the wire value becomes serverAngle and predictOwnAim / followServerAim ease onto it. Seat
     identity has to match or the carried angle belongs to somebody else. */
  playerFromSnapshot(p,i,old){
    const keep=old&&old.id===p.id;
    return {...p,i,meta:META[i],bot:false,held:keep?old.held:{},serverAngle:p.angle,
      angle:keep?old.angle:p.angle,aimTarget:keep?old.aimTarget:null};
  }
  applyOnlineSnapshot(s){
    if(s.kind==='battle'){this.applyOnlineBattleSnapshot(s);return;}
    const oldState=this.state;this.settings={...this.settings,...s.settings};this.profileKey=this.settings.campaign==='coop2'&&s.cols===GRID_PROFILES.coop2.evenColumns?'coop2':'classic';this.applyRoomControls();if(this.setViewH(this.settings.viewH??H0))this.relayout();this.WW=s.WW;this.cols=s.cols;this.parityFlip=s.parityFlip;this.anchorRow=s.anchorRow||0;this.gridTop=s.gridTop;this.gridTopTarget=s.gridTopTarget;this.lowestY=s.lowestY;this.grid=new Map(s.grid.map(b=>[key(b.r,b.c),b]));this.objects=s.objects||[];this.objectFallback=!!s.objectFallback;this.flights=s.flights||[];
    this.players=(s.players||[]).map((p,i)=>this.playerFromSnapshot(p,i,this.players?.[i]));this.activeP=Math.max(0,this.players.findIndex(p=>p.id===this.onlinePlayerId));this.score=s.score;this.dispScore=s.dispScore;this.missMeter=s.missMeter;this.onlineMissLimit=s.missLimit;this.pressure=s.pressure||0;this.onlinePerDrop=s.perDrop||0;this.danger=s.danger;this.chain={...s.chain,players:new Set(s.chain.players||[])};this.passCd=s.passCd||0;this.teamPowerCharge=s.teamPowerCharge||0;this.teamPowerActive=s.teamPowerActive||null;this.teamPowerTimer=s.teamPowerTimer||0;this.now=s.now;this.state=s.state;
    this.falling=this.falling||[];this.fx=[];this.pops=this.pops||[];this.callouts=this.callouts||[];this.sfxLog=this.sfxLog||[];this.sparks=this.sparks||[];this.ripples=this.ripples||[];this.popups=this.popups||[];this.teamFx=this.teamFx||[];this.shake=this.shake||0;
    this.showObjectGuide();
    for(const event of s.events||[])if(event.id>(this._lastOnlineEvent||0)){this._lastOnlineEvent=event.id;this.applyOnlineEvent(event);}
    const p=this.players[this.activeP];if(this.profile==='coop2')this.camX=0;else if(p){const target=clamp(p.x+Math.sin(p.angle)*420-W/2,0,Math.max(0,this.WW-W));this.camX=this.camX===undefined?target:this.camX+(target-this.camX)*.35;}
    this.lobbyEl.style.display='none';this.reconnectEl.style.display='none';this.pauseEl.style.display=s.state==='paused'?'grid':'none';this.shadowRoot.querySelector('.onlineBar').style.display='flex';this.syncOnlineControls();
    // Between levels the room sits on a scoreboard until everyone says go; the snapshot
    // carries the summary and the ready list, so a rejoin lands on the same card.
    // A clear seen live holds its card until the final drop lands (tickOutro); a rejoin shows it at once.
    if(oldState==='play'&&(s.state==='levelup'||s.state==='won'))this.beginOutro(()=>{});
    const present=show=>{if(this._outro)this._outro.show=show;else show();};
    if(s.levelSummary){const su=s.levelSummary,ready=s.levelReady||[];
      present(()=>this.showLevelCard({from:su.from,next:su.next,bonus:su.bonus,timeBonus:su.timeBonus,secs:su.secs,score:su.score,
        rows:this.playerStatRows(su.players),
        ready:{count:ready.length,total:(this.players||[]).filter(p=>p.connected!==false).length,secs:s.levelSecs,me:ready.includes(this.onlinePlayerId)}}));}
    else if(oldState==='levelup'&&s.state!=='levelup'){this._outro=null;this.levelUpEl.style.display='none';}
    if((s.state==='won'||s.state==='lost')&&oldState!==s.state)present(()=>this.showEnd(s.state==='won'));
  }
  battleBoardFromSnapshot(summary,data,old={}){
    const seat=summary.seat,wirePlayer=(data?.players||[])[0]||data?.player||null,wasPlayer=old.player?.id===summary.id?old.player:null;
    const rawPlayer=wirePlayer||wasPlayer||{x:W/2,angle:0,cur:null,next:null,reload:0};
    const player={...(wasPlayer||{}),...rawPlayer,i:0,id:summary.id,name:summary.name,meta:META[seat],bot:false,held:wasPlayer?wasPlayer.held:{},
      serverAngle:Number.isFinite(wirePlayer?.angle)?wirePlayer.angle:wasPlayer?.serverAngle,
      angle:wasPlayer?wasPlayer.angle:rawPlayer.angle??0,aimTarget:wasPlayer?wasPlayer.aimTarget:null,
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
    this._battlePreviews=this._battlePreviews||new Map();const freshPreviews=new Map((s.overview||[]).map(preview=>[preview.id,preview]));
    for(const preview of freshPreviews.values())this._battlePreviews.set(preview.id,preview);
    const summaries=[...(s.boards||[])].sort((a,b)=>a.seat-b.seat),boards=summaries.map(summary=>{
      const old=oldById.get(summary.id)||{},data=summary.id===this.onlinePlayerId?s.self:(freshPreviews.get(summary.id)||(old.id?null:this._battlePreviews.get(summary.id)));
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
  applyOnlineEvent(e){const d=e.data||{};if(e.kind==='bomb_empty'){if(d.player===this.activeP){this.callout('OUT OF BOMBS',META[d.player].accent);this.sfx('passNo');}}else if(e.kind==='launch'){const p=this.players[d.player];if(p)p.recoilT=this.now;this.sfx('launch');this.dropWarnSfx();}else if(e.kind==='hurry'){this.showHurry(d.player);}else if(e.kind==='bounce')this.sfx('bounce');else if(e.kind==='attach'){this.ripples.push({x:this.cellX(d.r,d.c),y:this.cellY(d.r),t:this.now});this.sfx('attach');}else if(e.kind==='pop'){for(const b of d.bubbles||[])this.pops.push({x:this.cellX(b.r,b.c),y:this.cellY(b.r),kind:b.kind,special:b.special,t:this.now,parts:[]});this.sfx((d.bubbles||[]).length>=6?'bigpop':'pop');}else if(e.kind==='drop'){for(const b of d.bubbles||[])this.falling.push({x:this.cellX(b.r,b.c),y:this.cellY(b.r),vx:0,vy:100,kind:b.kind,special:b.special,spin:0,a:0});this.sfx('drop');}else if(e.kind==='warn'){this.callout('DANGER! CLEAR THE LINE!','#ff5b6b');this.sfx('warn');}else if(e.kind==='rescue'){if(!(d.team&&TEAM.feedback))this.callout('TEAM RESCUE! +500','#3ecf72');this.sfx('rescue');}else if(e.kind==='team_play'){this.showTeamPlay(d,{x:d.x,y:d.y});}else if(e.kind==='pass'){this.showPass(d);}else if(e.kind==='team_power_charge'){this.showTeamPowerCharge(d);}else if(e.kind==='team_power_ready'){this.showTeamPowerReady();}else if(e.kind==='team_power_activated'){this.showTeamPowerActivated(d);}else if(e.kind==='team_power_ended'){this.showTeamPowerEnded();}else if(e.kind==='tri_lock'){this.showTriLock(d);}else if(['object_state','object_complete','object_spread','object_warning','object_fallback'].includes(e.kind)){this.showObjectEvent(e.kind,d);}else if(e.kind==='trio_chain'){this.showTrioChain(d.by);}else if(e.kind==='team_chain'){this.chainFx={pulseT:this.now,handoffT:d.handoff?this.now:(this.chainFx?.handoffT??-9),by:d.by};if(d.mult>=2&&!d.trio&&TEAM.feedback)this.teamChainCallout(d.by,d.from??-1,d.mult);}else if(e.kind==='ceiling'){this.callout('CEILING DROPS!','#ff5b6b');this.sfx('ceiling');}else if(e.kind==='attack_ready'){this.callout('BIG CLEAR! PICK A TARGET!','#ff8a3c');this.sfx('attackReady');}else if(e.kind==='attack_sent'){this.sfx('target');}else if(e.kind==='garbage'){const from=this.battle?.boards.find(b=>b.id===d.fromId);this.callout((from?.name||'A RIVAL')+' DUMPED '+d.amount+'!','#ff5b6b');this.sfx('junk');}else if(e.kind==='field_refilled'){this.callout('FIELD CLEAR! +1000','#3ecf72');}else if(e.kind==='level_cleared'){this.callout(d.final?'FINAL LEVEL CLEARED!':'LEVEL CLEARED! +'+((d.bonus||0)+(d.timeBonus||0)+(d.bombBonus||0)),'#3ecf72');this.sfx('win');}else if(e.kind==='eliminated')this.sfx('lose');else if(e.kind==='win')this.sfx('win');else if(e.kind==='lose')this.sfx('lose');}
  setOnlineAnalog(value){
    this._onlineHeld=this._onlineHeld||{l:false,r:false};
    if((this._onlineHeld.analog||0)===value)return;
    this._onlineHeld.analog=value;this._onlineAim=null;this._onlineAimWant=null;this.sendOnlineInput();
  }
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
  returnHome(){clearTimeout(this._reconnectTimer);this.online=false;this.onlineRoom=null;this.onlinePlayerId=null;this._geoLocked=false;this.restoreLocalPrefs();this.state='home';this.hideOverlays();this.lobbyEl.style.display='none';this.reconnectEl.style.display='none';this.tutEl.style.display='none';this.homeEl.style.display='grid';this.shadowRoot.querySelector('.onlineBar').style.display='none';this.closeSide();this.syncSideScope();this.measure();this.resetGame();this.state='home';}
  escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  buildSettings() {
    const S = this.settings, el = this.sideEl;
    el.innerHTML = `
<button class="sideClose" type="button" title="Close settings" aria-label="Close settings">✕</button>
<h2>Bubble Together</h2>
<div class="sideSub" style="color:#7593b5;font-size:13px">game settings</div>
<div class="roomOwned">
<h3>Campaign</h3><div class="seg campaignSeg"><button data-c="original">Original 52</button><button data-c="coop2">Bubble Together 2</button></div>
<div class="campaignNote" style="color:#9db8d4;font-size:12px;margin-top:4px">Bubble Together 2 is a separate 52-level campaign built specifically for two human players.</div>
<h3>Mode</h3><div class="seg modeSeg">
  <button data-m="clear">Co-op Clear</button><button data-m="endless">Endless</button><button data-m="battle">Battle</button></div>
<div class="battleNote" style="display:none;color:#9db8d4;font-size:12px;margin-top:4px">battle royale: private boards \u00b7 big clears let you dump junk on a rival \u00b7 you vs. bots locally, humans online</div>
<div class="fieldWrap"><h3>Field</h3><div class="seg fldSeg">
  <button data-f="classic">Classic</button><button data-f="wide">Wide 4\u00d7</button></div>
<div style="color:#9db8d4;font-size:12px;margin-top:2px">wide: the camera pans as you aim</div></div>
<h3>Level</h3>
<select class="lvlSel" aria-label="Level">${levelOptionsHTML()}</select>
<details><summary>Custom level editor</summary>
  <div style="color:#9db8d4;font-size:12px;margin:6px 0">One row per line \u00b7 colours R G Y B P O \u00b7 # stone, * star, + rainbow, dot = empty \u00b7 rows alternate 11 / 10 wide \u00b7 floaters are removed</div>
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
<div class="row"><span>Hurry-up</span><input type="range" class="hu" min="0" max="20" step="1"><span class="val huv"></span></div>
<div class="row"><span>Rescue timer</span><input type="range" class="rc" min="3" max="5" step="0.5"><span class="val rcv"></span></div>
<div class="row"><span>Aim assist</span><input type="range" class="aa" min="0" max="1" step="0.05"><span class="val aav"></span></div>
<div class="row"><span>Aim speed</span><input type="range" class="as" min="0.6" max="6" step="0.1"><span class="val asv"></span></div>
<div class="row"><span>Touch tint</span><input type="range" class="pt" min="0" max="0.3" step="0.005"><span class="val ptv"></span></div>
<div class="row"><span>FIRE size</span><input type="range" class="fs" min="0.6" max="2.2" step="0.05"><span class="val fsv"></span></div>
<div style="color:#9db8d4;font-size:12px;margin-top:-2px">touch tint: how strongly the aim halves glow blue while held · in an online room the host sets aim speed, tint and FIRE size for everyone</div>
</div>
<div class="row"><span>Touch aiming</span><div class="seg amSeg">
  <button data-am="halves">Left / right</button><button data-am="point">Where I press</button></div></div>
<div style="color:#9db8d4;font-size:12px;margin-top:-2px">where I press: drag anywhere on the board and the cannon swings to your finger · FIRE still shoots · touch screens only, and it stays yours in online rooms</div>
<div class="row"><span>Display</span><div class="seg dispSeg">
  <button data-d="auto">Auto</button><button data-d="desktop">Desktop</button><button data-d="tv">TV</button></div></div>
<div style="color:#9db8d4;font-size:12px;margin-top:-2px">TV: a 16:9 couch layout with a big HUD and controller menus · auto picks it for a big widescreen driven by a gamepad · saved on this device</div>
<details class="calibration"><summary>Controller Calibration / Stick Deadzone</summary><p>Left aiming stick · use the D-pad to navigate here. Auto Calibrate gives you one second to release controls, then measures for 2.5 seconds.</p><p>Saved on this browser per controller model. Identical controllers use connection order; check assignments after reconnecting.</p><div class="stickCards"></div></details>
<button class="btn ghost tvOnly sfOpen">Screen Fit\u2026</button>
<div class="roomOwned">
<div class="row"><span>Aim guide</span><div class="seg glSeg">
  <button data-g="1">Full path</button><button data-g="0.5">Short</button><button data-g="0.25">Tiny</button></div></div>
<div class="row tlRow"><span>Teammate lines</span><div class="seg tlSeg"><button data-v="1">Show</button><button data-v="0">Hide</button></div></div>
<div class="row"><span>Sound</span><div class="seg sndSeg"><button data-v="1">On</button><button data-v="0">Off</button></div></div>
<button class="btn ghost pauseBtn">Pause (P)</button>
<button class="btn ghost resetBtn">Reset stage</button>
</div>
<button class="btn ghost howBtn">How to play</button>
<h3>Controls</h3>
<ul class="ctrlList">${META.slice(0,4).map((m, i) => `<li${i ? '' : ' class="ctrlP1"'}><b style="color:${m.accent}">${m.name}</b> \u2014 <span class="ctrlText">${m.ctrl}</span></li>`).join('')}</ul>`;
    this.calibrationEl = el.querySelector('.calibration');
    this.calibrationEl.ontoggle = () => {
      if (this.calibrationEl.open) {
        if (!this.online && this.state === 'play') this.togglePause();
        if (this.online) { this.setOnlineAnalog(0); this.setOnlineHeld('l', false); this.setOnlineHeld('r', false); }
      }
      this.syncCalibration();
    };
    const segWire = (sel, get, set) => el.querySelectorAll(sel + ' button').forEach(b => {
      b.onclick = () => { set(b); syncAll(); };
    });
    const syncAll = () => {
      const campaign=S.campaign||'original', coopOnly=campaign==='coop2';
      el.querySelectorAll('.campaignSeg button').forEach(b => b.classList.toggle('on', b.dataset.c === campaign));
      el.querySelectorAll('.modeSeg button').forEach(b => { b.classList.toggle('on', b.dataset.m === S.mode); b.disabled=coopOnly&&b.dataset.m!=='clear'; });
      el.querySelectorAll('.fldSeg button').forEach(b => { b.classList.toggle('on', b.dataset.f === S.field); b.disabled=coopOnly&&b.dataset.f!=='classic'; });
      el.querySelectorAll('.cntSeg button').forEach(b => b.classList.toggle('on', +b.dataset.n === S.players));
      el.querySelectorAll('.botSeg button').forEach(b => b.classList.toggle('on', b.dataset.b === S.botSkill));
      el.querySelectorAll('.tlSeg button').forEach(b => b.classList.toggle('on', (+b.dataset.v === 1) === S.mateLines));
      el.querySelectorAll('.glSeg button').forEach(b => b.classList.toggle('on', +b.dataset.g === S.guide));
      el.querySelectorAll('.sndSeg button').forEach(b => b.classList.toggle('on', (+b.dataset.v === 1) === S.sound));
      const lvlSel=el.querySelector('.lvlSel');
      if(lvlSel.dataset.campaign!==campaign){lvlSel.innerHTML=levelOptionsHTML(campaign);lvlSel.dataset.campaign=campaign;}
      lvlSel.value = String(S.level);
      // The original local 2P board may rename authored variants; Campaign 2 names are native.
      lvlSel.querySelectorAll('option').forEach(o => { const i = +o.value, name = this.roundName(i);
        if (name && o.textContent !== (i + 1) + '. ' + name) o.textContent = (i + 1) + '. ' + name; });
      const customDetails=el.querySelector('.lvlSel').nextElementSibling; if(customDetails) customDetails.style.display=coopOnly?'none':'';
      el.querySelectorAll('.cntSeg button').forEach(b=>b.disabled=coopOnly&&+b.dataset.n!==2);
      el.querySelector('.rl').value = S.reload; el.querySelector('.rlv').textContent = S.reload.toFixed(2) + 's';
      el.querySelector('.mm').value = S.missMax; el.querySelector('.mmv').textContent = S.missMax;
      el.querySelector('.sp').value = S.pressureShots;
      el.querySelector('.spv').textContent = S.pressureShots ? S.pressureShots + ' shots' : 'off';
      el.querySelector('.hu').value = S.hurry; el.querySelector('.huv').textContent = S.hurry ? S.hurry + 's' : 'off';
      el.querySelector('.rc').value = S.rescueDur; el.querySelector('.rcv').textContent = S.rescueDur.toFixed(1) + 's';
      el.querySelector('.aa').value = S.assist; el.querySelector('.aav').textContent = Math.round(S.assist * 100) + '%';
      el.querySelector('.as').value = S.aimSpeed; el.querySelector('.asv').textContent = S.aimSpeed.toFixed(1) + '×';
      el.querySelector('.pt').value = S.padTint;
      el.querySelector('.ptv').textContent = S.padTint ? (S.padTint * 100).toFixed(1) + '%' : 'off';
      el.querySelector('.fs').value = S.fireScale; el.querySelector('.fsv').textContent = S.fireScale.toFixed(2) + '×';
      el.querySelectorAll('.amSeg button').forEach(b => b.classList.toggle('on', b.dataset.am === S.aimMode));
      this.syncDisplaySegs();
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
          b.onclick = () => { if(S.campaign==='coop2')return; S.human[i] = +b.dataset.h === 1;
            const p = this.players[i]; if (p) { p.bot = !S.human[i]; p.plan = null; }
            this.activeP = this.players.findIndex(q => !q.bot); if (this.activeP < 0) this.activeP = 0;
            syncAll(); };
        });
        pl.appendChild(row);
      }
      this.syncButtons();
    };
    this._syncSettings = syncAll; // so the level chain can re-mark the level picker
    segWire('.campaignSeg', null, b => { S.campaign=b.dataset.c; S.level=0;
      if(S.campaign==='coop2'){S.mode='clear';S.field='classic';S.players=2;S.human=[true,true,false,false];}
      this.resetGame(); });
    segWire('.modeSeg', null, b => { if(S.campaign==='coop2'&&b.dataset.m!=='clear')S.campaign='original'; S.mode = b.dataset.m;
      if (S.mode === 'battle') { if (S.players < 4) S.players = 8; else if (S.players === 4) S.players = 8; }
      else if (S.players > 4) S.players = 4;
      this.resetGame(); });
    segWire('.fldSeg', null, b => { if(S.campaign==='coop2'&&b.dataset.f!=='classic')S.campaign='original'; S.field = b.dataset.f; this.resetGame(); });
    el.querySelector('.lvlSel').onchange = e => {
      S.level = e.target.value === 'custom' ? 'custom' : +e.target.value;
      this.resetGame(); syncAll();
    };
    const ta = el.querySelector('.lvlTxt');
    try { ta.value = localStorage.getItem('bt_custom_level') || 'RRGGBBYYRRG\nR...BB...G\n....YY.....'; } catch(e) {}
    el.querySelector('.playCustom').onclick = () => {
      this.customText = ta.value;
      try { localStorage.setItem('bt_custom_level', ta.value); } catch(e) {}
      S.level = 'custom'; this.resetGame(); syncAll();
    };
    segWire('.cntSeg', null, b => { if(S.campaign==='coop2'&&+b.dataset.n!==2)return; S.players = +b.dataset.n; if (S.mode !== 'battle') S.missMax = 4 + 2 * S.players;
      // Moving to or from two players swaps the board itself, not just the launchers.
      if (S.mode === 'battle' || this.gridProfile() !== this.profileKey) this.resetGame(); else this.spawnPlayers(); });
    segWire('.botSeg', null, b => { S.botSkill = b.dataset.b; });
    segWire('.tlSeg', null, b => { S.mateLines = +b.dataset.v === 1; });
    segWire('.glSeg', null, b => { S.guide = +b.dataset.g; });
    segWire('.sndSeg', null, b => { S.sound = +b.dataset.v === 1; if (S.sound) this.ensureAudio(); });
    segWire('.amSeg', null, b => { S.aimMode = b.dataset.am; this.applyTouchStyle(); this.saveLocalPrefs(); });
    el.querySelectorAll('.dispSeg button').forEach(b => { b.onclick = () => this.setDisplayMode(b.dataset.d); });
    el.querySelector('.sfOpen').onclick = () => this.openScreenFit();
    const slider = (cls, fmt, set) => { const s = el.querySelector(cls);
      s.oninput = () => { set(parseFloat(s.value)); syncAll(); }; };
    slider('.rl', 0, v => S.reload = v);
    slider('.mm', 0, v => S.missMax = v);
    slider('.sp', 0, v => S.pressureShots = v);
    slider('.hu', 0, v => S.hurry = v);
    slider('.rc', 0, v => S.rescueDur = v);
    slider('.aa', 0, v => S.assist = v);
    slider('.as', 0, v => { S.aimSpeed = v; this.saveLocalPrefs(); });
    slider('.pt', 0, v => { S.padTint = v; this.applyTouchStyle(); this.saveLocalPrefs(); });
    slider('.fs', 0, v => { S.fireScale = v; this.applyTouchStyle(); this.saveLocalPrefs(); });
    el.querySelector('.pauseBtn').onclick = () => this.togglePause();
    el.querySelector('.resetBtn').onclick = () => { this.state = 'play'; this.resetGame(); };
    el.querySelector('.howBtn').onclick = () => this.showTutorial();
    el.querySelector('.sideClose').onclick = () => this.closeSide();
    this._syncSettings = syncAll;
    this.syncSideScope();
    syncAll();
  }
  closeSide() { this.sideEl && this.sideEl.classList.remove('open'); }
  /* In a room the host owns the match: mode, level, tuning, aim speed, tint, FIRE size and
     even sound all arrive with every snapshot and overwrite whatever this device set. Showing
     those controls online would be a lie — moving one changes nothing that survives the next
     50 ms. So the panel narrows to what is genuinely this device's: how you aim. Hiding the
     whole panel was the old answer, and it is what made the gear look broken mid-match. */
  syncSideScope() {
    const el = this.sideEl; if (!el || !el.querySelector('.sideSub')) return;
    const online = !!this.online;
    el.querySelectorAll('.roomOwned').forEach(b => { b.style.display = online ? 'none' : ''; });
    el.querySelector('.sideSub').textContent = online
      ? 'the host sets the match — these are your device’s controls'
      : 'game settings';
  }
  syncButtons() {
    const b = this.sideEl && this.sideEl.querySelector('.pauseBtn');
    if (b) b.textContent = this.state === 'paused' ? 'Resume (P)' : 'Pause (P)';
  }
}
customElements.define('coop-bubbles', CoopBubbles);
})();
