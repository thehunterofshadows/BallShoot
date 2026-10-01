'use strict';

// Shared rules for local Co-op Clear and the online authority. Presentation only reads
// these states; the client never sends object actions to the server.
const CoopObjects = (() => {
  const key = ([r, c]) => `${r},${c}`;
  const TYPES = new Set(['shield', 'syncLock', 'teamArmor', 'corruption']);
  const validate = level => {
    const objects = level.objects || [], ids = new Set(), targets = new Set();
    for (const o of objects) {
      if (!o.id || ids.has(o.id)) throw Error(`${level.name}: duplicate/missing object id ${o.id}`);
      ids.add(o.id);
      if (!TYPES.has(o.type)) throw Error(`${level.name}: invalid object type ${o.type}`);
      if (!Array.isArray(o.cells) || o.cells.length !== 1) throw Error(`${level.name}: ${o.id} needs one target cell`);
      if (targets.has(key(o.cells[0]))) throw Error(`${level.name}: duplicate object target`);
      targets.add(key(o.cells[0]));
      if (o.barrier?.length && o.type !== 'syncLock') throw Error(`${level.name}: ${o.id} has no barrier unlock source`);
      for (const [r, c] of [...o.cells, ...(o.barrier || [])]) {
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= level.rows.length || c < 0 || c >= level.rows[r].length || level.rows[r][c] === '.')
          throw Error(`${level.name}: ${o.id} has an invalid cell`);
      }
      if (o.requiredPlayers !== undefined && (!Number.isInteger(o.requiredPlayers) || o.requiredPlayers < 2 || o.requiredPlayers > 4))
        throw Error(`${level.name}: ${o.id} has an invalid player requirement`);
      if (o.type === 'corruption' && (!Number.isInteger(o.every) || o.every < 1 || !Number.isInteger(o.maxSpread) || o.maxSpread < 0 || o.maxSpread > 8))
        throw Error(`${level.name}: ${o.id} has invalid spread bounds`);
    }
    for (const o of objects) if (o.type === 'syncLock') {
      const pair = objects.find(p => p.id === o.pair);
      if (!pair || pair.type !== 'syncLock' || pair.pair !== o.id || pair.id === o.id)
        throw Error(`${level.name}: ${o.id} has an invalid pair`);
      const barrier = (o.barrier || []).map(key).sort().join('|');
      if (!barrier || barrier !== (pair.barrier || []).map(key).sort().join('|') || o.requiredPlayers !== pair.requiredPlayers)
        throw Error(`${level.name}: ${o.id} has no shared unlockable barrier`);
    }
    return true;
  };
  const create = (level, enabled, players = 2) => {
    validate(level);
    return enabled ? (level.objects || []).filter(o => !o.requiredPlayers || players >= o.requiredPlayers).map(o => ({ ...structuredClone(o), state:'ready', by:null, timer:0,
      contributors:[], spread:[], shots:0 })) : [];
  };
  const shift = (objects, n) => {
    for (const o of objects) {
      o.cells.forEach(c => { c[0] += n; });
      o.barrier?.forEach(c => { c[0] += n; });
      o.spread.forEach(c => { c[0] += n; });
    }
  };
  const hit = (g, x, y) => {
    if (g.settings?.mode !== 'clear') return null;
    let best = null, distance = (2 * 28 * .88) ** 2;
    for (const o of g.objects || []) {
      if (o.state === 'done' || o.state === 'open') continue;
      const [r,c] = o.cells[0];
      if (!g.grid.has(key([r,c]))) continue;
      const d = (g.cellX(r,c)-x)**2 + (g.cellY(r)-y)**2;
      if (d < distance) { distance = d; best = o; }
    }
    // A nearby target does not steal a shot that first struck a normal bubble.
    if (best) for (const b of g.grid.values()) {
      if (key([b.r,b.c]) === key(best.cells[0])) continue;
      const d = (g.cellX(b.r,b.c)-x)**2 + (g.cellY(b.r)-y)**2;
      if (d < distance) return null;
    }
    return best;
  };
  const protectedCell = (g, cell) => g.settings?.mode === 'clear' && (g.objects || []).some(o =>
    key(o.cells[0]) === cell && (o.type === 'syncLock' && o.state !== 'open' ||
      o.type === 'teamArmor' && o.state !== 'done' || o.type === 'shield' && o.state === 'ready'));
  const reward = (g, o, by, setup) => {
    const cooperative = setup !== null && setup !== by && !g.objectFallback;
    g.objectEvent('object_complete', { id:o.id, type:o.type, by, setup, cooperative, points:cooperative ? 150 : 0, ...g.objectWhere(o) });
    if (cooperative) g.objectReward(by, setup, g.objectWhere(o));
  };
  const remove = (g, cells, by) => g.objectRemove([...new Set(cells.map(key))], by);
  const onPop = (g, cell, by) => {
    const o = (g.objects || []).find(q => q.type === 'shield' && q.state === 'exposed' && key(q.cells[0]) === cell);
    if (o) { const setup = o.by; o.state = 'done'; reward(g,o,by,setup); }
  };
  const interact = (g, o, by) => {
    if (o.type === 'shield') {
      if (o.state === 'ready') {
        o.state = 'exposed'; o.by = by; o.timer = 6;
        g.objectEvent('object_state', { id:o.id, type:o.type, state:o.state, by, ...g.objectWhere(o) });
      } else if (o.state === 'exposed') {
        const setup = o.by; o.state = 'done';
        reward(g,o,by,setup); remove(g,o.cells,by);
      }
    } else if (o.type === 'syncLock') {
      const pair = g.objects.find(p => p.id === o.pair);
      if (pair && pair.state === 'armed' && (pair.by !== by || g.objectFallback) && pair.timer > 0) {
        const setup = pair.by; o.state = pair.state = 'open';
        reward(g,o,by,setup);
        remove(g,[...o.cells,...pair.cells,...(o.barrier || [])],by);
      } else {
        o.state = 'armed'; o.by = by; o.timer = 5;
        g.objectEvent('object_state', { id:o.id, type:o.type, state:o.state, by, ...g.objectWhere(o) });
      }
    } else if (o.type === 'teamArmor') {
      if (!o.contributors.includes(by)) o.contributors.push(by);
      if (o.contributors.length >= 2 || g.objectFallback) {
        const setup = o.contributors.length >= 2 ? o.contributors[0] : null;
        o.state = 'done'; reward(g,o,by,setup); remove(g,o.cells,by);
      } else {
        o.state = 'marked';
        g.objectEvent('object_state', { id:o.id, type:o.type, state:o.state, by, ...g.objectWhere(o) });
      }
    } else if (o.type === 'corruption') {
      o.state = 'done'; g.objectEvent('object_state', { id:o.id, type:o.type, state:'done', by, ...g.objectWhere(o) });
      remove(g,o.cells,by);
    }
  };
  const removed = g => {
    if (g.settings?.mode !== 'clear') return;
    for (const o of g.objects || []) {
      if (o.state === 'done' || o.state === 'open') continue;
      if (g.grid.has(key(o.cells[0]))) continue;
      if (o.type === 'syncLock') {
        const pair = g.objects.find(p => p.id === o.pair);
        o.state = 'open'; if (pair) pair.state = 'open';
        remove(g,[...(pair?.cells || []),...(o.barrier || [])],null);
      } else o.state = 'done';
      g.objectEvent('object_state', { id:o.id, type:o.type, state:o.state, by:null, ...g.objectWhere(o) });
    }
  };
  const tick = (g, dt) => {
    if (g.settings?.mode !== 'clear') return;
    const live = g.players.filter(p => !p.bot && p.connected !== false).length;
    if (live < 2 && g.objects?.length) g.objectAlone = (g.objectAlone || 0) + dt;
    else { g.objectAlone = 0; g.objectFallback = false; }
    if (g.objectAlone >= 10 && !g.objectFallback) {
      g.objectFallback = true;
      g.objectEvent('object_fallback', {});
    }
    if (live < 2 && !g.objectFallback) return; // reconnect grace holds the puzzle clocks
    for (const o of g.objects || []) if (o.timer > 0) {
      o.timer = Math.max(0, o.timer - dt);
      if (!o.timer && (o.state === 'armed' || o.state === 'exposed')) {
        o.state = 'ready'; o.by = null;
        g.objectEvent('object_state', { id:o.id, type:o.type, state:'ready', ...g.objectWhere(o) });
      }
    }
  };
  const shot = g => {
    if (g.settings?.mode !== 'clear') return;
    for (const o of g.objects || []) if (o.type === 'corruption' && o.state !== 'done') {
      o.shots++;
      if (o.shots % o.every === o.every - 1 && o.spread.length < o.maxSpread)
        g.objectEvent('object_warning', {id:o.id,...g.objectWhere(o)});
      if (o.shots % o.every || o.spread.length >= o.maxSpread) continue;
      const frontier = [...o.cells,...o.spread], candidates = new Map();
      for (const [r,c] of frontier) for (const [nr,nc] of g.neighbors(r,c)) {
        if (g.validCell(nr,nc) && nr <= o.cells[0][0] + 2 && nr >= o.cells[0][0] - 2)
          candidates.set(key([nr,nc]),[nr,nc]);
      }
      const cell = [...candidates.values()].sort((a,b) => a[0]-b[0] || a[1]-b[1])[0];
      if (!cell) continue;
      o.spread.push(cell);
      g.grid.set(key(cell), {r:cell[0],c:cell[1],kind:'#',special:'stone',corrupted:true,placedBy:-1});
      g.updateLowest();
      g.objectEvent('object_spread', { id:o.id, ...g.objectWhere(o), spread:{r:cell[0],c:cell[1]} });
    }
  };
  return { validate, create, shift, hit, protectedCell, onPop, interact, removed, tick, shot };
})();

if (typeof module !== 'undefined') module.exports = CoopObjects;
if (typeof globalThis !== 'undefined') globalThis.CoopObjects = CoopObjects;
