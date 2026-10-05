'use strict';

/* Player profiles: the rules both sides agree on. The server (server/profiles.js) is the
   only store and the only place totals are computed; the browser uses these same rules to
   validate a name before sending it and to build the per-round result it submits.

   A round result carries what one round did — never a running total — and every field is
   bounded here, so a client can at worst claim one implausible-but-capped round, and a
   retried submission with the same roundId is applied once. */
const CoopProfiles = (() => {
  const NAME_MAX = 16;
  // Letters/digits in any script, plus the few separators people actually put in names.
  const NAME_OK = /^[\p{L}\p{N} '._-]+$/u;
  const NAME_TAKEN = 'That name already exists. Choose a different name.';
  const fail = (code, message) => Object.assign(new Error(message), { code });

  const cleanName = raw => {
    const v = String(raw == null ? '' : raw).normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!v) throw fail('bad_name', 'Enter a name.');
    if ([...v].length > NAME_MAX) throw fail('bad_name', `Names can be at most ${NAME_MAX} characters.`);
    if (!NAME_OK.test(v)) throw fail('bad_name', "Use letters, numbers, spaces, or - . _ '");
    return v;
  };
  // Uniqueness is case-insensitive: "amy" and "Amy" are the same player on the couch.
  const nameKey = name => cleanName(name).toLocaleLowerCase('en-US');

  /* What one player did in one round. `max` caps a single round, generously above anything
     a real round reaches, so a hostile client cannot add an absurd lump in one post. */
  const PLAYER_FIELDS = {
    score:      { max: 2_000_000 }, // this player's attributed share of the team score
    shots:      { max: 20_000 },
    popped:     { max: 50_000 },    // bubbles this player's shots matched and popped
    biggestPop: { max: 5_000 },     // most bubbles one shot popped
    bestChain:  { max: 16 },        // highest chain multiplier this player cleared at
    bombsUsed:  { max: 999 },
    bombsLeft:  { max: 999 },       // reserve bombs still unused when the round ended
    fusions:    { max: 999 },       // Fusion Bursts this player took part in
  };
  const ROUND_MAX_SECS = 6 * 3600, TEAM_SCORE_MAX = 8_000_000, MODES = ['clear', 'endless', 'battle'];

  /* Lifetime stats are derived from round results by these rules, so adding a stat is one
     entry here (missing keys read as 0) rather than a schema change. */
  const LIFETIME = {
    score:      { kind: 'sum', from: 'score' },
    rounds:     { kind: 'count' },
    wins:       { kind: 'win' },
    shots:      { kind: 'sum', from: 'shots' },
    popped:     { kind: 'sum', from: 'popped' },
    biggestPop: { kind: 'max', from: 'biggestPop' },
    bestChain:  { kind: 'max', from: 'bestChain' },
    bombsUsed:  { kind: 'sum', from: 'bombsUsed' },
    bombsSaved: { kind: 'sum', from: 'bombsLeft' },
    fusions:    { kind: 'sum', from: 'fusions' },
    playSecs:   { kind: 'time' },
    bestRound:  { kind: 'max', from: 'score' },
  };
  // Team history for every unordered pair of profiles that played a round together.
  const PAIR = {
    rounds:        { kind: 'count' },
    wins:          { kind: 'win' },
    bestTeamScore: { kind: 'team' },
    bestChain:     { kind: 'max', from: 'bestChain' },
    fusions:       { kind: 'both', from: 'fusions' },
    playSecs:      { kind: 'time' },
  };
  const applyStats = (rules, into, round, players) => {
    for (const [k, rule] of Object.entries(rules)) {
      const cur = Number(into[k]) || 0, vals = players.map(p => Number(p[rule.from]) || 0);
      if (rule.kind === 'sum') into[k] = cur + vals.reduce((a, b) => a + b, 0);
      else if (rule.kind === 'max') into[k] = Math.max(cur, ...vals);
      else if (rule.kind === 'both') into[k] = cur + Math.min(...vals);
      else if (rule.kind === 'count') into[k] = cur + 1;
      else if (rule.kind === 'win') into[k] = cur + (round.won ? 1 : 0);
      else if (rule.kind === 'time') into[k] = cur + round.secs;
      else if (rule.kind === 'team') into[k] = Math.max(cur, round.teamScore);
    }
    return into;
  };

  const pairKey = (a, b) => [String(a), String(b)].sort().join('+');
  const pairsOf = ids => { const out = []; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push(pairKey(ids[i], ids[j])); return out; };

  const int = (v, max, what) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw fail('bad_result', `${what} is out of range.`);
    return v;
  };
  /* `levelCount(campaign)` is how many authored levels the campaign has, or 0 if unknown. */
  const cleanRound = (raw, levelCount) => {
    const r = raw && typeof raw === 'object' ? raw : {};
    const roundId = String(r.roundId || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(roundId)) throw fail('bad_result', 'A round id is required.');
    if (!MODES.includes(r.mode)) throw fail('bad_result', 'Unknown mode.');
    const campaign = String(r.campaign || 'original');
    const count = levelCount(campaign);
    if (!count) throw fail('bad_result', 'Unknown campaign.');
    // Only authored Co-op Clear levels carry progress; endless, battle and custom boards do not.
    let level = null;
    if (r.mode === 'clear' && r.level !== null && r.level !== undefined && r.level !== 'custom') level = int(r.level, count - 1, 'Level');
    const out = { roundId, mode: r.mode, campaign, level, won: r.won === true,
      secs: int(r.secs, ROUND_MAX_SECS, 'Round time'), teamScore: int(r.teamScore, TEAM_SCORE_MAX, 'Team score'), players: [] };
    if (!Array.isArray(r.players) || !r.players.length || r.players.length > 8) throw fail('bad_result', 'Players are required.');
    const seen = new Set();
    for (const p of r.players) {
      const profileId = String(p && p.profileId || '');
      if (!profileId || seen.has(profileId)) throw fail('bad_result', 'Each profile may appear once.');
      seen.add(profileId);
      const clean = { profileId };
      for (const [k, f] of Object.entries(PLAYER_FIELDS)) clean[k] = int(p[k] === undefined ? 0 : p[k], f.max, k);
      out.players.push(clean);
    }
    // Shares of one team score cannot add up to more than it.
    if (out.players.reduce((n, p) => n + p.score, 0) > out.teamScore) throw fail('bad_result', 'Player scores exceed the team score.');
    return out;
  };

  /* The on-screen keyboard: a letter grid then an action row, navigated by d-pad/stick.
     Kept here so its layout and navigation are tested without a browser. */
  const KEY_COLS = 8;
  const KEY_CHARS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ' ', '-', "'"];
  const KEY_ACTIONS = ['back', 'clear', 'cancel', 'ok'];
  const keyRows = () => {
    const rows = [];
    for (let i = 0; i < KEY_CHARS.length; i += KEY_COLS) rows.push(KEY_CHARS.slice(i, i + KEY_COLS).map((_, k) => i + k));
    rows.push(KEY_ACTIONS.map((_, k) => KEY_CHARS.length + k));
    return rows;
  };
  const keyAt = i => i < KEY_CHARS.length ? { char: KEY_CHARS[i] } : { action: KEY_ACTIONS[i - KEY_CHARS.length] };
  // Moves wrap within a row; vertical moves keep the same relative position across rows of different widths.
  const keyMove = (i, dx, dy) => {
    const rows = keyRows(), r = rows.findIndex(row => row.includes(i));
    if (r < 0) return 0;
    const row = rows[r], c = row.indexOf(i);
    if (dx) return row[(c + dx + row.length) % row.length];
    if (!dy) return i;
    const nr = (r + dy + rows.length) % rows.length, next = rows[nr];
    const t = row.length > 1 ? c / (row.length - 1) : 0;
    return next[Math.round(t * (next.length - 1))];
  };

  return { NAME_MAX, NAME_TAKEN, cleanName, nameKey, PLAYER_FIELDS, LIFETIME, PAIR, applyStats, pairKey, pairsOf,
    cleanRound, ROUND_MAX_SECS, KEY_COLS, KEY_CHARS, KEY_ACTIONS, keyRows, keyAt, keyMove, fail };
})();
if (typeof module !== 'undefined') module.exports = CoopProfiles;
if (typeof globalThis !== 'undefined') globalThis.CoopProfiles = CoopProfiles;
