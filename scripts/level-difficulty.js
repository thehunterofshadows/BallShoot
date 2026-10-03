'use strict';

const occupied = rows => rows.reduce((n, row) => n + [...row].filter(ch => ch !== '.').length, 0);
const count = (rows, chars) => rows.reduce((n, row) => n + [...row].filter(ch => chars.includes(ch)).length, 0);

const analyzeLevels = levels => levels.map((L, i) => {
  const cells = occupied(L.rows), capacity = L.rows.reduce((n, row) => n + row.length, 0);
  const previous = i ? occupied(levels[i - 1].rows) : cells;
  return {
    level: i + 1, name: L.name, rows: L.rows.length, cells,
    densityPct: Math.round(cells / capacity * 1000) / 10,
    cellJumpPct: i ? Math.round((cells / previous - 1) * 1000) / 10 : 0,
    helpers: count(L.rows, '*+'), stones: count(L.rows, '#'),
    mechanics: (L.objects || []).length, drop: L.drop,
  };
});

if (require.main === module) {
  const { LEVELS, COOP2_LEVELS } = require('../server/game');
  const print = (title, levels) => {
    const report = analyzeLevels(levels); console.log('\n' + title);
    console.table(report.map(r => ({ level:r.level, name:r.name, cells:r.cells, density:r.densityPct + '%', jump:r.cellJumpPct + '%', helpers:r.helpers, stones:r.stones, mechanics:r.mechanics, drop:r.drop })));
    return report;
  };
  const original = print('Original 52', LEVELS), sequel = print('Bubble Together 2', COOP2_LEVELS);
  // Original picture levels intentionally vary, but the finale may not cliff. The sequel is
  // designed as a smooth two-player campaign, so guard the whole run.
  const originalFlags = original.filter((r, i) => i && r.level >= 46 && (r.cellJumpPct > 16 || (r.drop < original[i - 1].drop && r.cellJumpPct > 12)));
  const sequelFlags = sequel.filter((r, i) => i && (r.cellJumpPct > 6 || r.cells < sequel[i - 1].cells || r.drop > sequel[i - 1].drop));
  const flags=[...originalFlags.map(r=>`Original ${r.level} ${r.name}`),...sequelFlags.map(r=>`BT2 ${r.level} ${r.name}`)];
  if (flags.length) { console.error('Difficulty spike:', flags.join(', ')); process.exitCode = 1; }
}

module.exports = { analyzeLevels };
