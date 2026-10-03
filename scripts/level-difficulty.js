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
  const { LEVELS } = require('../server/game');
  const report = analyzeLevels(LEVELS);
  console.table(report.map(r => ({ level:r.level, name:r.name, cells:r.cells, density:r.densityPct + '%', jump:r.cellJumpPct + '%', helpers:r.helpers, stones:r.stones, mechanics:r.mechanics, drop:r.drop })));
  // Guard the authored finale, where a sudden spike is most costly; earlier picture-level variety is intentionally uneven.
  const flags = report.filter((r, i) => i && r.level >= 46 && (r.cellJumpPct > 16 || (r.drop < report[i - 1].drop && r.cellJumpPct > 12)));
  if (flags.length) { console.error('Difficulty spike:', flags.map(r => `${r.level} ${r.name}`).join(', ')); process.exitCode = 1; }
}

module.exports = { analyzeLevels };
