'use strict';
const CoopObjects = require('../coop-objects');

const W = 640, R = 28, X0 = 12;
const ROWH = R * Math.sqrt(3), GRIDTOP0 = 108;
/* Mirror of the client geometry in coop-bubbles.js: the field is always 640 wide and
   11 columns, but the world height comes from the room's viewH so the whole table
   shares one danger line no matter what each player's device looks like. */
const H0 = 1080, VIEWH_MIN = H0, VIEWH_MAX = 1560, LAUNCH_GAP = 142, DANGER_GAP = 92;
const LEVEL_READY_SECS = 60; // backstop on the between-levels ready gate
const KINDS = ['R', 'Y', 'G', 'B'];
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
const key = (r, c) => `${r},${c}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const geom = vh => {
  const H = clamp(Math.round((Number(vh) || H0) / 20) * 20, VIEWH_MIN, VIEWH_MAX), LAUNCH_Y = H - LAUNCH_GAP;
  return { H, LAUNCH_Y, DANGER_Y: LAUNCH_Y - DANGER_GAP };
};

/* Shared aim integrator, mirrored verbatim in coop-bubbles.js so the client's prediction and
   this authority agree frame for frame.

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
const aimTick = (p, dt, aimSpeed) => {
  if (p.aimTarget != null) { p.angle = clamp(p.aimTarget, -AIM_MAX, AIM_MAX); p.heldT = 0; p.heldDir = 0; return; }
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
  if (pair.some(p => !p || p.connected === false || !p.cur)) return null;
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
    start: pair => { for (const p of pair) if (p.cur) p.cur = { kind: p.cur.kind, special: 'rainbow' }; },
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
  if (!(limit > 0) || (p.held && (p.held.l || p.held.r)) || p.aimTarget != null) { p.idle = 0; return null; }
  const was = p.idle || 0, warnAt = Math.max(0, limit - PACE.hurryWarn);
  p.idle = was + dt;
  if (p.idle >= limit) return 'fire';
  return was <= warnAt && p.idle > warnAt ? 'warn' : null;
};
/* pace-rules:end */

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
    this.levelSummary = null; this.levelReadyIds = new Set(); this.levelTimer = 0;
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
      for (let i = 0; i < row.length; i++) {
        const cell = levelCell(row[i]), c = i + off;
        if (cell) this.grid.set(key(r, c), { r, c, ...cell, special: S.level === 34 && r === 1 && i === 4 && this.roster.length >= 3 && S.mode === 'clear' ? 'triLock' : cell.special, contributors: [], placedBy: -1 });
      }
    });
    this.levelColors = levelColors(rows);
    this.removeFloaters();
    const level = S.level === 'custom' ? null : LEVELS[Number(S.level) || 0];
    this.objects = CoopObjects.create(level || {name:'Custom',rows}, S.mode === 'clear' && this.roster.length >= 2, this.roster.length)
      .flatMap(o => offs.map((off, i) => {
        const copy = structuredClone(o); copy.id += `_${i}`; if (copy.pair) copy.pair += `_${i}`;
        copy.cells.forEach(c => { c[1] += off; }); copy.barrier?.forEach(c => { c[1] += off; }); return copy;
      }));
    this.objectAlone = 0; this.objectFallback = false;
    this.flights = []; this.batch = []; this.resolveAt = 0;
    this.score = carry ? carry.score : 0;
    this.dispScore = carry ? carry.score : 0; this.missMeter = 0; this.danger = null;
    this.rowTimer = 0; this.shotCount = 0; this.specialFlip = 0; this.pressure = 0;
    this.chain = { mult: 1, last: -1, same: 0, players: new Set(), t: 0, trioAwarded: false };
    this.passCd = 0;
    // The meter is the team's, so it carries into the next level; a running power does not.
    this.teamPowerCharge = carry ? (carry.teamPowerCharge || 0) : 0;
    this.teamPowerActive = null; this.teamPowerTimer = 0;
    if (!carry) { this.now = 0; this.events = []; this.eventId = 0; this.paused = false; }
    this.levelStartT = this.now; // the clear clock; `now` stands still while paused or between levels
    const prior = carry ? new Map(carry.players.map(p => [p.id, p])) : null;
    this.players = this.roster.map((member, i) => {
      const was = prior?.get(member.id);
      return {
        ...member, x: this.WW * (i + 0.5) / this.roster.length,
        angle: was ? was.angle : this.rnd(-0.3, 0.3), cur: null, next: null, reload: 0,
        held: { l: false, r: false }, aimTarget: null, connected: was ? was.connected : true,
        stats: was ? was.stats : { shots: 0, pops: 0, bubbles: 0, assists: 0, drops: 0, rescues: 0, attacks: 0, chains: 0 },
      };
    });
    for (const p of this.players) { p.cur = this.genBubble(); p.next = this.genBubble(); }
    this.updateLowest();
    this.emit('round_started', { seed: this.tickId });
  }

  levelRows() {
    if (this.settings.level === 'custom') {
      const rows = String(this.settings.customText || '').split('\n')
        .map(s => s.trim().toUpperCase().replace(/[^RGYBPO#*+.]/g, '.')).filter(Boolean).slice(0, 12)
        .map((s, r) => (s + '.'.repeat((r % 2) ? 10 : 11)).slice(0, (r % 2) ? 10 : 11));
      if (rows.some(s => /[RGYBPO]/.test(s))) return rows;
    }
    return (LEVELS[Number(this.settings.level) || 0] || LEVELS[0]).rows;
  }
  // Shots per ceiling drop as authored; a custom board has none and runs on the setting.
  levelDrop() { return this.settings.level === 'custom' ? 0 : (LEVELS[Number(this.settings.level) || 0] || LEVELS[0]).drop; }
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
        if (!seen.has(k) && b && !CoopObjects.protectedCell(this,k) && (b.kind === kind || b.special === 'rainbow')) { seen.add(k); stack.push([nr,nc]); }
      }
    }
    return seen;
  }
  hypoSize(r, c, kind) { return this.matchGroup(r, c, kind).size; }

  setConnected(id, connected) { const p = this.players.find(q => q.id === id); if (p) { p.connected = connected; if (!connected) { p.held = { l:false, r:false }; p.aimTarget = null; p.heldT = 0; this.checkLevelGate(); }
    else if (this.players.filter(q => !q.bot && q.connected).length >= 2) { this.objectAlone = 0; this.objectFallback = false; }
  } }
  objectWhere(o) { const [r,c] = o.cells[0]; return { x:this.cellX(r,c), y:this.cellY(r), r, c }; }
  objectEvent(kind, data) { this.emit(kind, data); }
  objectReward(by, setup, where) {
    this.score += 150;
    if (this.players[setup]) this.players[setup].stats.assists++;
    const handoff = this._resolvingBatch ? 0 : (this.registerClear(by) ? 1 : 0);
    this.emit('team_play', { assists:[{by,setup:[setup]}], bonus:150, ...where });
    this.chargeTeamPower({assists:[{by,setup:[setup]}],rescue:null,drop:null},handoff,where);
  }
  objectRemove(keys, by) {
    const removed = [];
    for (const k of keys) { const b = this.grid.get(k); if (b) { removed.push(b); this.grid.delete(k); } }
    if (removed.length) {
      this.emit('pop', { bubbles:removed, points:0, shooters:by === null ? [] : [by] });
      const dropped = this.removeFloaters();
      if (dropped.length) this.emit('drop', {bubbles:dropped,points:0,shooters:by === null ? [] : [by]});
      this.updateLowest(); this.refreshQueues();
    }
    CoopObjects.removed(this);
    if (this.settings.mode === 'clear' && !this.grid.size && this.state === 'play') this.clearLevel();
  }
  /* `aim` is the point-to-aim absolute angle; anything that is not a finite number — including
     the client clearing it on finger-up — puts the launcher back on the held-direction stream. */
  input(id, held, aim) {
    const p = this.players.find(q => q.id === id);
    if (!p || !p.connected || this.state !== 'play') return;
    p.held = { l: !!(held && held.l), r: !!(held && held.r) };
    p.aimTarget = Number.isFinite(aim) ? clamp(Number(aim), -AIM_MAX, AIM_MAX) : null;
    // A tap can start and end between two ticks, so aiming resets the hurry clock here too.
    if (p.held.l || p.held.r || p.aimTarget != null) p.idle = 0;
  }
  fire(id, auto = false) {
    const p = this.players.find(q => q.id === id);
    if (!p || !p.connected || this.state !== 'play' || this.paused || this.inputLocked || p.reload > 0) return false;
    const a = clamp(p.angle, -1.22, 1.22), sp = 1150;
    this.flights.push({ p: p.i, x: p.x, y: this.LAUNCH_Y - 44, vx: Math.sin(a)*sp, vy: -Math.cos(a)*sp,
      kind: p.cur.kind, special: p.cur.special, trail: [], bounceCd: 0, at: this.now });
    p.cur = p.next; p.next = this.genBubble(); p.reload = this.settings.reload; p.stats.shots++; p.idle = 0;
    CoopObjects.shot(this);
    if (!powerHolds(this.teamPowerActive, 'holdPressure')) this.pressure++;
    this.emit('launch', { player: p.i, x: p.x, angle: a, auto: auto || undefined });
    return true;
  }
  /* There is no swap: a player shoots the colour they were dealt. The queue is a constraint
     to play around rather than one to reorder. PASS is a different thing — it trades the
     loaded bubble with your teammate and leaves both queues otherwise alone. */
  /* The client only asks. What each launcher ends up holding is whatever this authority
     already had, never a bubble the request carried, and the shared cooldown is what makes a
     second request in the same instant a no-op rather than a swap back. */
  requestPass(id, direction = 1) {
    const p = this.players.find(q => q.id === id);
    if (!p || this.inputLocked) return false;
    const pair = passPair(this.teamHumans(), this.players, p.i, this.paused ? 'paused' : this.state, this.passCd, direction);
    if (!pair) return false;
    passSwap(pair); this.passCd = PASS.cooldown; p.idle = 0;
    this.emit('pass', { by: p.i, players: pair.map(q => q.i), cur: pair.map(q => ({ ...q.cur })), cooldown: PASS.cooldown });
    return true;
  }
  /* Team Power, like PASS, is only ever asked for. The charge, the check and the effect are
     all this authority's, and emptying the meter as it fires is what makes a partner's
     request in the same instant a no-op. */
  activateTeamPower(id) {
    const p = this.players.find(q => q.id === id);
    if (!p || this.inputLocked) return false;
    const pair = powerPair(TEAM_POWER, this.teamHumans(), this.players, p.i, this.paused ? 'paused' : this.state,
      this.teamPowerCharge, this.teamPowerActive);
    if (!pair) return false;
    const power = TEAM_POWER.equipped, def = POWERS[power];
    this.teamPowerCharge = 0; this.teamPowerActive = power; this.teamPowerTimer = def.secs;
    def.start(pair);
    this.emit('team_power_activated', { by: p.i, power, name: def.name, secs: def.secs,
      players: pair.map(q => q.i), cur: pair.map(q => q.cur && { ...q.cur }) });
    return true;
  }
  // Charge from what resolveBatch already decided; never from anything a client said.
  chargeTeamPower(team, handoffs, where) {
    const { amount, reasons } = powerCharge(TEAM_POWER, team, handoffs, this.teamPowerActive);
    if (!amount || this.teamPowerCharge >= TEAM_POWER.max) return;
    const was = this.teamPowerCharge;
    this.teamPowerCharge = Math.min(TEAM_POWER.max, was + amount);
    this.emit('team_power_charge', { amount: this.teamPowerCharge - was, charge: this.teamPowerCharge, reasons, ...where });
    if (this.teamPowerCharge >= TEAM_POWER.max) this.emit('team_power_ready', { charge: this.teamPowerCharge });
  }
  endTeamPower() {
    const power = this.teamPowerActive; if (!power) return;
    this.teamPowerActive = null; this.teamPowerTimer = 0;
    this.emit('team_power_ended', { power });
  }
  emit(kind, data = {}) { this.events.push({ id: ++this.eventId, kind, data, at: this.now }); if (this.events.length > 128) this.events.shift(); }

  update(dt) {
    // Between levels the board is frozen but the backstop keeps counting, so a room whose
    // last unready player has walked away still moves on.
    if (this.state === 'levelup') {
      this.tickId++;
      if (this.levelTimer > 0 && (this.levelTimer -= Math.min(0.05, dt)) <= 0) { this.levelTimer = 0; this.checkLevelGate(); }
      return;
    }
    if (this.state !== 'play' || this.paused) return;
    dt = Math.min(0.05, dt); this.now += dt; this.tickId++;
    CoopObjects.tick(this, dt);
    if (this.passCd > 0) this.passCd = Math.max(0, this.passCd - dt);
    if (this.teamPowerActive && (this.teamPowerTimer -= dt) <= 0) this.endTeamPower();
    const holdPressure = powerHolds(this.teamPowerActive, 'holdPressure');
    this.gridTop += clamp(this.gridTopTarget - this.gridTop, -80*dt, 80*dt);
    for (const p of this.players) {
      p.reload = Math.max(0, p.reload - dt);
      if (!p.connected || this.inputLocked) continue;
      aimTick(p, dt, this.settings.aimSpeed);
    }
    // Hurry-up: every connected human in a shared-board room. Battle boards and a running
    // power (which holds the ceiling's clocks) leave the idle clock where it is.
    if (!this.battle && !this.inputLocked && !holdPressure) for (const p of this.players) {
      if (!p.connected) continue;
      const hurry = hurryTick(p, dt, Number(this.settings.hurry) || 0);
      if (hurry === 'warn') this.emit('hurry', { player: p.i, secs: Math.min(PACE.hurryWarn, Number(this.settings.hurry)) });
      else if (hurry === 'fire') this.fire(p.id, true);
    }
    this.stepFlights(dt);
    if (this.resolveAt && this.now >= this.resolveAt) this.resolveBatch();
    const perDrop = this.shotsPerDrop();
    if (perDrop && this.pressure >= perDrop && !this.resolveAt && !holdPressure) {
      this.pressure = 0; this.descendRow(); this.emit('ceiling');
    }
    if (this.chain.t > 0 && (this.chain.t -= dt) <= 0) this.chain = { mult:1, last:-1, same:0, players:new Set(), t:0, trioAwarded:false };
    const danger = this.anyDangerCells();
    if (danger && !this.danger) { this.danger = { t:this.settings.rescueDur, max:this.settings.rescueDur }; this.emit('warn'); }
    else if (!danger && this.danger) this.danger = null;
    if (this.danger && !powerHolds(this.teamPowerActive, 'holdRescue') && (this.danger.t -= dt) <= 0) return this.end(false);
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
    const object = CoopObjects.hit(this, f.x, f.y);
    if (object) { CoopObjects.interact(this, object, f.p); return; }
    let cell = this.snapCell(f.x,f.y); if (!cell) return;
    if (!f.special && this.settings.assist > 0 && this.hypoSize(cell.r,cell.c,f.kind) < 3) {
      for (const [r,c] of this.neighbors(cell.r,cell.c)) if (this.validCell(r,c) &&
        Math.hypot(this.cellX(r,c)-f.x,this.cellY(r)-f.y) < 2.7*R && this.hypoSize(r,c,f.kind) >= 3 && this.random() < this.settings.assist) { cell={r,c}; break; }
    }
    const b = { ...cell, kind:f.kind, special:f.special, placedBy:f.p, at:this.now, fired:f.at };
    this.grid.set(key(cell.r,cell.c),b); this.markTriLocks(b); this.batch.push(b); this.resolveAt ||= this.now+.2; this.updateLowest();
    this.emit('attach',{player:f.p,r:cell.r,c:cell.c});
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
      this.emit('tri_lock', { r, c, by:b.placedBy, contributors:[...lock.contributors], unlocked });
    }
  }
  resolveBatch() {
    this._resolvingBatch = true;
    const landed=this.batch; this.batch=[]; this.resolveAt=0; const results=[];
    for (const b of landed) {
      if (!this.grid.has(key(b.r,b.c))) { results.push({shooter:b.placedBy,at:b.fired,gone:true}); continue; }
      if (b.special==='bomb') {
        const bx=this.cellX(b.r,b.c), by=this.cellY(b.r), popped=new Set([key(b.r,b.c)]);
        this.grid.forEach((g,k)=>{ if(g.special!=='stone'&&g.special!=='triLock'&&Math.hypot(this.cellX(g.r,g.c)-bx,this.cellY(g.r)-by)<=R*4.3)popped.add(k); });
        results.push({shooter:b.placedBy,at:b.fired,popped,bomb:true});
      } else {
        let kind=b.kind;
        if(b.special==='rainbow'){
          let best=null,size=0; for(const [r,c] of this.neighbors(b.r,b.c)){const n=this.grid.get(key(r,c)); if(n&&!n.special){const s=this.matchGroup(b.r,b.c,n.kind).size;if(s>size){size=s;best=n.kind;}}}
          if(!best){results.push({shooter:b.placedBy,at:b.fired});continue;} kind=best;
        }
        const group=this.matchGroup(b.r,b.c,kind), star=starHit(this.grid,this.neighbors(b.r,b.c),b,kind);
        if(star){group.forEach(k=>star.add(k));results.push({shooter:b.placedBy,at:b.fired,popped:star,star:true});continue;}
        results.push({shooter:b.placedBy,at:b.fired,popped:group.size>=3?group:null});
      }
    }
    const all=new Set(), owners=new Set(), clearers=[], shots=[];
    for(const result of results) if(result.popped){const fresh=[]; result.popped.forEach(k=>{if(!all.has(k)&&this.grid.has(k)&&!CoopObjects.protectedCell(this,k)){const b=this.grid.get(k);CoopObjects.onPop(this,k,result.shooter);if(b.placedBy>=0&&b.placedBy!==result.shooter)owners.add(b.placedBy);all.add(k);fresh.push(b);}});if(fresh.length){clearers.push(result.shooter);shots.push({shooter:result.shooter,at:result.at,bubbles:fresh});}}
    const popped=[]; all.forEach(k=>{const b=this.grid.get(k);if(b){popped.push(b);this.grid.delete(k);}});
    const dropped=this.removeFloaters(); this.updateLowest();
    CoopObjects.removed(this);
    // Team rules read what the shot removed and who placed it. The rescue half is decided
    // where the rescue itself is, after any ceiling descent. Solo and Battle have no team events.
    const humans=this.teamHumans(), teamOn=humans.length>=2, where=this.centerOf(popped.concat(dropped));
    let team=teamPlay(TEAM,humans,shots,dropped,false),handoffs=0;
    if(popped.length){if(!this.battle)clearers.forEach(i=>{if(this.registerClear(i))handoffs++;});const pts=this.popPoints(popped.length)*(this.battle?1:this.chain.mult);this.score+=pts;for(const i of clearers){const p=this.players[i];if(p){p.stats.pops++;p.stats.bubbles+=popped.length;}}(teamOn?new Set(team.assists.flatMap(a=>a.setup)):owners).forEach(i=>{if(this.players[i])this.players[i].stats.assists++;});this.missMeter=Math.max(0,this.missMeter-1);this.emit('pop',{bubbles:popped,points:pts,shooters:clearers,team:teamOn?team:undefined});}
    // A power that holds the pressure holds the miss meter too: both are the ceiling's clock.
    const misses=powerHolds(this.teamPowerActive,'holdPressure')?0:results.filter(r=>!r.popped&&!r.gone&&!r.bomb).length;
    if(misses){this.missMeter+=misses;if(this.missMeter>=this.missLimit()*0.6){this.chain.mult=1;this.chain.players.clear(); this.chain.trioAwarded = false;}if(this.missMeter>=this.missLimit()){this.missMeter=0;this.descendRow();this.emit('ceiling');}}
    if(dropped.length){const pts=this.dropPoints(dropped.length,this.countComponents(dropped))*(this.battle?1:this.chain.mult);this.score+=pts;clearers.forEach(i=>{if(this.players[i])this.players[i].stats.drops+=dropped.length;});this.missMeter=dropped.length>=8?0:Math.max(0,this.missMeter-3);this.emit('drop',{bubbles:dropped,points:pts,shooters:clearers,team:teamOn?team:undefined});}
    if(this.danger&&!this.anyDangerCells()){if(team.assists.length)team=teamPlay(TEAM,humans,shots,dropped,true);this.danger=null;this.score+=500;clearers.forEach(i=>{if(this.players[i])this.players[i].stats.rescues++;});this.emit('rescue',{team:!!team.rescue});}
    if(team.bonus){this.score+=team.bonus;this.emit('team_play',{...team,...where});}
    if(teamOn)this.chargeTeamPower(team,handoffs,where);
    this.refreshQueues();
    const total=popped.length+dropped.length;
    if(this.battle&&total>=6){const amount=clamp(2+Math.round(total*.7),3,14);this.emit('attack_ready',{amount});this.hooks.onAttack?.(amount);}
    if(this.battle&&!this.grid.size)this.refillBattleBoard();
    if(this.settings.mode==='clear'&&!this.grid.size&&this.state==='play')this.clearLevel();
    this._resolvingBatch = false;
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
    const headroom = Math.max(0, this.missLimit() - this.missMeter) / Math.max(1, this.missLimit());
    return Math.round(accuracy * 1500) + Math.round(headroom * 500);
  }
  /* A cleared level is an intermission, not a cut. The run pauses on a scoreboard and the
     next level starts when every connected player has said they are ready — the whole point
     of a co-op room is that nobody is dropped into a fresh board still reading the last one.
     LEVEL_READY_SECS is the backstop: one player who walks away must not freeze the room. */
  clearLevel() {
    const from = this.levelIndex(), next = this.nextLevelIndex(), bonus = this.levelBonus();
    const secs = Math.max(0, this.now - this.levelStartT), timeBonus = clearTimeBonus(secs);
    this.score += bonus + timeBonus;
    if (next < 0) { this.emit('level_cleared', { level: from, bonus, timeBonus, secs, final: true }); return this.end(true); }
    this.emit('level_cleared', { level: from, next, bonus, timeBonus, secs, final: false });
    this.state = 'levelup';
    this.levelReadyIds = new Set();
    this.levelTimer = LEVEL_READY_SECS;
    this.levelSummary = {
      from, next, bonus, timeBonus, secs, score: this.score,
      players: this.players.map(p => ({ i: p.i, stats: { ...p.stats } })),
    };
  }
  /* Anyone still connected can hold the gate; a disconnect releases it, so the check runs
     again from disconnect() as well as from here. */
  levelReadyCount() {
    const live = this.players.filter(p => p.connected);
    return { count: live.filter(p => this.levelReadyIds.has(p.id)).length, total: live.length };
  }
  levelReady(id) {
    if (this.state !== 'levelup') return false;
    const p = this.players.find(q => q.id === id);
    if (!p || !p.connected) return false;
    this.levelReadyIds.add(id);
    this.checkLevelGate();
    return true;
  }
  checkLevelGate() {
    if (this.state !== 'levelup') return;
    const { count, total } = this.levelReadyCount();
    if (total > 0 && count < total && this.levelTimer > 0) return;
    this.startNextLevel();
  }
  startNextLevel() {
    const next = this.levelSummary ? this.levelSummary.next : this.nextLevelIndex();
    this.levelSummary = null; this.levelReadyIds = new Set(); this.levelTimer = 0;
    this.state = 'play';
    this.settings.level = next;
    this.reset({ score: this.score, players: this.players, teamPowerCharge: this.teamPowerCharge });
    this.emit('level_started', { level: next });
  }
  refillBattleBoard(){
    this.score+=1000;this.gridTop=GRIDTOP0;this.gridTopTarget=GRIDTOP0;this.parityFlip=0;this.anchorRow=0;this.pressure=0;
    const rows=this.levelRows();for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++){const cell=levelCell(rows[r][c]);if(cell)this.grid.set(key(r,c),{r,c,...cell,placedBy:-1});}
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
  /* In Co-op Clear each new human clearer contributes to the live chain; a handoff
     is announced so the client can flash it. */
  // Returns whether this clear was a handoff: the teammate keeping the chain alive.
  registerClear(i) {
    const c = this.chain, humans = this.teamHumans(), solo = this.players.length <= 1;
    const team = humans.length >= 2, from = c.last;
    let handoff = false;
    if (solo || from !== i) {
      c.mult = Math.min(c.mult + 1, 4); c.same = 0;
      if (team && this.players[i]) {
        handoff = from >= 0 && from !== i;
        this.players[i].stats.chains = (this.players[i].stats.chains || 0) + 1;
      }
    } else if (++c.same >= 3) { c.mult = 1; c.players.clear(); c.trioAwarded = false; c.same = 0; }
    c.last = i; c.players.add(i); c.t = TEAM.chainSecs;
    if (team && (from !== i || c.players.size >= 3)) {
      const trio = humans.length >= 3 && humans.filter(h => c.players.has(h)).length === 3 && from !== i && !c.trioAwarded;
      if (trio) c.trioAwarded = true;
      this.emit('team_chain', { by:i, from, mult:c.mult, handoff, players:[...c.players], trio });
      if (trio) { this.score += 300; this.emit('trio_chain', { by:i, players:[...c.players], bonus:300 }); }
    }
    return handoff;
  }
  teamHumans() { return !this.battle && this.settings.mode === 'clear'
    ? this.players.filter(p => !p.bot).map(p => p.i) : []; }
  missLimit() { return Math.round(this.settings.missMax * (1 + 0.25 * Math.max(0, (this.battle ? 1 : this.players.filter(p => !p.bot && p.connected).length) - 2))); }
  centerOf(bubbles){if(!bubbles.length)return{x:this.WW/2,y:300};let x=0,y=0;for(const b of bubbles){x+=this.cellX(b.r,b.c);y+=this.cellY(b.r);}return{x:Math.round(x/bubbles.length),y:Math.round(y/bubbles.length)};}
  anyDangerCells(){let hit=false;this.grid.forEach(b=>{if(this.cellY(b.r)+R>this.DANGER_Y)hit=true;});return hit;}
  // Puzzle Bobble ceiling descent: the whole pack slides down one row and the
  // wall stagger alternates. Bumping r and parityFlip together leaves par(r) —
  // and therefore cellX — invariant, so nothing shifts sideways. Dropping
  // gridTop by ROWH at the same instant cancels the jump, and the existing
  // gridTop -> gridTopTarget easing plays the slide out over ~0.6s.
  descendRow(){
    const ng=new Map();this.grid.forEach(b=>{b.r++;ng.set(key(b.r,b.c),b);});this.grid=ng;
    CoopObjects.shift(this.objects,1);
    this.parityFlip^=1;this.anchorRow++;this.gridTop-=ROWH;
    this.updateLowest();this.refreshQueues();
  }
  shotsPerDrop(){ return dropPace(this.levelDrop(),this.settings.pressureShots,this.levelColors,this.availKinds().length,this.battle ? 1 : this.players.filter(p => !p.bot && p.connected).length); }
  addRow(){const moved=new Map();this.grid.forEach(b=>{b.r++;moved.set(key(b.r,b.c),b);});this.grid=moved;this.parityFlip^=1;const a=this.anchorRow;for(let c=0;c<this.colsIn(a);c++)if(this.random()<.85)this.grid.set(key(a,c),{r:a,c,kind:KINDS[(this.random()*4)|0],special:null,placedBy:-1});this.updateLowest();this.refreshQueues();this.emit('ceiling');}
  end(won){if(this.state!=='play')return;this.state=won?'won':'lost';this.emit(won?'win':'lose',{score:this.score});}
  setPaused(value){if(this.state==='play'){this.paused=!!value;this.emit(this.paused?'paused':'resumed');}}

  snapshot() {
    return {
      tick:this.tickId, state:this.paused?'paused':this.state, now:this.now, settings:this.settings,
      WW:this.WW, cols:this.cols, parityFlip:this.parityFlip, anchorRow:this.anchorRow,
      gridTop:this.gridTop, gridTopTarget:this.gridTopTarget, pressure:this.pressure, perDrop:this.shotsPerDrop(),
      lowestY:this.lowestY, grid:[...this.grid.values()], objects:this.objects, objectFallback:this.objectFallback, flights:this.flights,
      players:this.players.map(p=>({...p,held:undefined,aimTarget:undefined})), score:this.score, dispScore:this.dispScore,
      missMeter:this.missMeter, missLimit:this.missLimit(), danger:this.danger, chain:{...this.chain,players:[...this.chain.players]},
      events:this.events.slice(-32), eventId:this.eventId,
      passCd:this.passCd, passMax:PASS.cooldown,
      teamPowerOn:this.teamHumans().length>=2, teamPowerCharge:this.teamPowerCharge, teamPowerMax:TEAM_POWER.max,
      teamPowerActive:this.teamPowerActive, teamPowerTimer:this.teamPowerTimer,
      teamPowerSecs:this.teamPowerActive?POWERS[this.teamPowerActive].secs:0,
      levelSummary:this.levelSummary||null,
      levelReady:this.levelSummary?[...this.levelReadyIds]:null,
      levelSecs:this.levelSummary?Math.max(0,Math.ceil(this.levelTimer)):null,
    };
  }
  snapshotFor(){return this.snapshot();}
}

module.exports = { OnlineGame, LEVELS, LEVEL_KINDS, GRID_PROFILES, rowsFit, levelLayout, levelCell, levelColors, starHit, PACE, dropPace, clearTimeBonus, hurryTick, clamp, geom, aimTick, AIM_MAX, TEAM, teamPlay, PASS, passPair, TEAM_POWER, POWERS, powerCharge, powerPair, normalizeViewH: vh => geom(vh).H };
