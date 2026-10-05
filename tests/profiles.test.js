'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../coop-profiles');
const { Profiles } = require('../server/profiles');
const { createServer } = require('../server/server');

const tmpFile = name => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ballshoot-profiles-')), name);
let seq = 0;
const roundId = () => 'round-' + (++seq).toString().padStart(6, '0');
const player = (profileId, extra = {}) => ({ profileId, score: 100, shots: 10, popped: 30, biggestPop: 6, bestChain: 2, bombsUsed: 1, bombsLeft: 2, fusions: 1, ...extra });
const round = (players, extra = {}) => ({ roundId: roundId(), mode: 'clear', campaign: 'original', level: 19, won: true, secs: 90, teamScore: 1000, players, ...extra });

test('names are trimmed, bounded, and unique without regard to case', () => {
  assert.equal(P.cleanName('  Justin   Lee '), 'Justin Lee');
  for (const bad of ['', '   ', null, 'x'.repeat(P.NAME_MAX + 1), '<b>hi</b>']) assert.throws(() => P.cleanName(bad), e => e.code === 'bad_name');
  const s = new Profiles('');
  s.create('Amy');
  for (const dup of ['amy', ' AMY ', 'Amy']) assert.throws(() => s.create(dup), e => e.code === 'name_taken' && e.message === P.NAME_TAKEN);
  assert.equal(s.list().length, 1, 'a duplicate never creates or overwrites a profile');
});

test('creation returns the saved profile immediately and the list carries summaries', () => {
  const s = new Profiles('');
  const amy = s.create('Amy'), justin = s.create('Justin');
  assert.ok(amy.id && amy.id !== justin.id);
  assert.deepEqual(s.list().map(p => p.name), ['Amy', 'Justin']);
  assert.equal(s.list()[0].levelsCompleted, 0);
});

test('a co-op win credits every profile, progress stays per campaign, and replays do not duplicate completion', () => {
  const s = new Profiles(''), a = s.create('Justin').id, b = s.create('Amy').id;
  s.record(round([player(a, { score: 600 }), player(b, { score: 400 })]));
  for (const id of [a, b]) {
    const d = s.detail(id);
    assert.equal(d.campaigns.original.levels[19].completed, true);
    assert.equal(d.campaigns.original.completed, 1);
    assert.equal(d.campaigns.coop2.completed, 0, 'campaigns are kept apart');
    assert.equal(d.campaigns.original.highest, 19);
  }
  // Replay: better score and time, still one completed level, two clears.
  s.record(round([player(a, { score: 900 })], { teamScore: 2000, secs: 60 }));
  const d = s.detail(a), lv = d.campaigns.original.levels[19];
  assert.equal(d.stats.levelsCompleted, 1);
  assert.equal(lv.clears, 2); assert.equal(lv.attempts, 2);
  assert.equal(lv.bestScore, 2000); assert.equal(lv.bestSecs, 60);
  // A loss on a later level counts an attempt but no completion.
  s.record(round([player(a, { score: 0 })], { level: 20, won: false, teamScore: 0 }));
  assert.equal(s.detail(a).campaigns.original.levels[20].completed, false);
  assert.equal(s.detail(a).stats.levelsCompleted, 1);
  // Same level number in the sequel campaign is a different level.
  s.record(round([player(a, { score: 0 })], { campaign: 'coop2', teamScore: 0 }));
  assert.equal(s.detail(a).campaigns.coop2.levels[19].completed, true);
  assert.equal(s.detail(a).stats.levelsCompleted, 2);
});

test('lifetime totals accumulate and record stats never regress', () => {
  const s = new Profiles(''), a = s.create('Ada').id;
  s.record(round([player(a, { score: 500, biggestPop: 12, bestChain: 4, popped: 40, fusions: 2 })], { secs: 100 }));
  s.record(round([player(a, { score: 200, biggestPop: 3, bestChain: 1, popped: 10, fusions: 0 })], { secs: 50, won: false }));
  const st = s.detail(a).stats;
  assert.equal(st.score, 700); assert.equal(st.rounds, 2); assert.equal(st.wins, 1);
  assert.equal(st.popped, 50); assert.equal(st.biggestPop, 12); assert.equal(st.bestChain, 4);
  assert.equal(st.bombsUsed, 2); assert.equal(st.bombsSaved, 4); assert.equal(st.fusions, 2); assert.equal(st.playSecs, 150);
});

test('a retried round is acknowledged once and never double-counted', () => {
  const s = new Profiles(''), a = s.create('Ada').id, r = round([player(a, { score: 500 })]);
  assert.equal(s.record(r).duplicate, false);
  assert.equal(s.record(structuredClone(r)).duplicate, true);
  assert.equal(s.record(structuredClone(r)).duplicate, true);
  assert.equal(s.detail(a).stats.score, 500);
  assert.equal(s.detail(a).stats.rounds, 1);
});

test('round results are validated and lifetime totals cannot be injected', () => {
  const s = new Profiles(''), a = s.create('Ada').id;
  const bad = [
    { ...round([player(a)]), roundId: 'x' },
    round([player(a)], { mode: 'nope' }),
    round([player(a)], { campaign: 'nope' }),
    round([player(a)], { level: 999 }),
    round([player(a, { score: -1 })]),
    round([player(a, { score: 1.5 })]),
    round([player(a, { popped: 1e9 })]),
    round([player(a, { score: 5000 })], { teamScore: 1000 }), // shares exceed the team score
    round([player(a), player(a)]),
    round([]),
    round([player(a)], { secs: 1e9 }),
  ];
  for (const r of bad) assert.throws(() => s.record(r), e => e.code === 'bad_result', JSON.stringify(r).slice(0, 80));
  // Unknown fields such as a client-claimed total are ignored, not trusted.
  s.record(round([{ ...player(a, { score: 10 }), lifetimeScore: 9e9 }], { stats: { score: 9e9 } }));
  assert.equal(s.detail(a).stats.score, 10);
  assert.equal(s.detail(a).stats.rounds, 1);
});

test('pair stats are order-independent and separate from individual stats', () => {
  const s = new Profiles(''), a = s.create('Justin').id, b = s.create('Amy').id, c = s.create('Cy').id;
  s.record(round([player(a), player(b)], { teamScore: 3000 }));
  s.record(round([player(b), player(a)], { teamScore: 1200, level: 20 }));
  assert.equal(s.pairs.size, 1, 'Justin + Amy and Amy + Justin are one pairing');
  assert.equal(P.pairKey(a, b), P.pairKey(b, a));
  const partner = s.detail(a).partners[0];
  assert.equal(partner.name, 'Amy'); assert.equal(partner.rounds, 2); assert.equal(partner.wins, 2);
  assert.equal(partner.bestTeamScore, 3000); assert.equal(partner.levelsTogether, 2);
  assert.equal(partner.fusions, 2);
  assert.equal(s.detail(c).partners.length, 0);
  // Trio rounds credit every pair.
  s.record(round([player(a), player(b), player(c)]));
  assert.equal(s.pairs.size, 3);
});

test('rename keeps id and history; delete cleans pair history without touching the partner', () => {
  const s = new Profiles(''), a = s.create('Justin').id, b = s.create('Amy').id;
  s.record(round([player(a, { score: 300 }), player(b, { score: 200 })]));
  assert.throws(() => s.rename(a, 'AMY'), e => e.code === 'name_taken');
  s.rename(a, 'justin', undefined); // a case change of your own name is fine
  const renamed = s.rename(a, 'Jay');
  assert.equal(renamed.id, a);
  const d = s.detail(a);
  assert.equal(d.profile.name, 'Jay'); assert.equal(d.stats.score, 300); assert.equal(d.campaigns.original.completed, 1);
  assert.equal(s.detail(b).partners[0].name, 'Jay');
  s.remove(a);
  assert.throws(() => s.detail(a), e => e.code === 'not_found');
  assert.equal(s.pairs.size, 0);
  const amy = s.detail(b);
  assert.equal(amy.stats.score, 200); assert.equal(amy.campaigns.original.completed, 1); assert.equal(amy.partners.length, 0);
  // A round naming the deleted player still saves for the survivor.
  s.record(round([player(a), player(b, { score: 50 })], { teamScore: 1000 }));
  assert.equal(s.detail(b).stats.score, 250);
});

test('the store round-trips through its file, including applied round ids', () => {
  const file = tmpFile('profiles.json');
  const s = new Profiles(file), a = s.create('Ada').id, b = s.create('Ben').id, r = round([player(a), player(b)]);
  s.record(r); assert.equal(s.flush(), true); s.close();
  const t = new Profiles(file);
  assert.deepEqual(t.list().map(p => p.name), ['Ada', 'Ben']);
  assert.equal(t.detail(a).stats.rounds, 1);
  assert.equal(t.detail(a).partners[0].name, 'Ben');
  assert.equal(t.record(r).duplicate, true, 'a retry after a restart is still recognised');
  assert.throws(() => t.create('ada'), e => e.code === 'name_taken');
  t.close();
});

test('a corrupt or unwritable store never takes the server down', () => {
  const file = tmpFile('profiles.json');
  fs.writeFileSync(file, 'not json');
  assert.equal(new Profiles(file).list().length, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballshoot-profiles-'));
  const s = new Profiles(path.join(dir, 'p.json'));
  fs.rmSync(dir, { recursive: true, force: true }); fs.writeFileSync(dir, 'file');
  assert.equal(s.flush(), false);
  s.create('Still Works');
  assert.equal(s.list().length, 1);
});

test('the profiles API works over plain HTTP with clear status codes', async () => {
  const app = createServer();
  app.profiles.file = ''; app.profiles.writable = false;
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}/profiles`;
  const call = (url, method = 'GET', body) => fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const created = await call(base, 'POST', { name: 'Justin' });
  assert.equal(created.status, 201);
  const justin = (await created.json()).profile;
  const dup = await call(base, 'POST', { name: 'JUSTIN' });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).message, P.NAME_TAKEN);
  assert.equal((await call(base, 'POST', { name: '   ' })).status, 400);
  const amy = (await (await call(base, 'POST', { name: 'Amy' })).json()).profile;
  const list = await call(base);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await list.json()).profiles.map(p => p.name), ['Amy', 'Justin']);
  const r = round([player(justin.id), player(amy.id)]);
  const first = await (await call(base + '/results', 'POST', r)).json();
  assert.equal(first.duplicate, false);
  assert.equal((await (await call(base + '/results', 'POST', r)).json()).duplicate, true);
  const detail = await (await call(base + '/' + justin.id)).json();
  assert.equal(detail.stats.rounds, 1);
  assert.equal(detail.partners[0].name, 'Amy');
  assert.equal((await call(base + '/' + justin.id, 'PATCH', { name: 'amy' })).status, 409);
  assert.equal((await (await call(base + '/' + justin.id, 'PATCH', { name: 'Jay' })).json()).profile.id, justin.id);
  assert.equal((await call(base + '/' + amy.id, 'DELETE')).status, 200);
  assert.equal((await call(base + '/' + amy.id)).status, 404);
  assert.equal((await call(base + '/results', 'POST', { ...r, roundId: 'bad' })).status, 400);
  assert.equal((await call(base, 'PUT')).status, 405);
  await new Promise(resolve => app.server.close(resolve)); app.wss.close();
});

test('nginx proxies /profiles ahead of the static rules and the shell loads the shared rules first', () => {
  const nginx = fs.readFileSync('nginx.conf', 'utf8'), html = fs.readFileSync('index.html', 'utf8');
  assert.match(nginx, /location \^~ \/profiles \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8080;[\s\S]*?no-store/);
  assert.ok(html.indexOf('coop-profiles.js?v=__PROFILE_VERSION__') > -1);
  assert.ok(html.indexOf('coop-profiles.js') < html.indexOf('coop-bubbles.js'));
  assert.match(fs.readFileSync('Dockerfile', 'utf8'), /__PROFILE_VERSION__/);
});

test('on-screen keyboard has every letter plus Backspace, Clear, Cancel and Confirm, and navigation stays on the grid', () => {
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') assert.ok(P.KEY_CHARS.includes(ch));
  assert.deepEqual(P.KEY_ACTIONS, ['back', 'clear', 'cancel', 'ok']);
  const all = P.keyRows().flat(), n = P.KEY_CHARS.length + P.KEY_ACTIONS.length;
  assert.deepEqual(all, [...Array(n).keys()]);
  for (const i of all) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.ok(all.includes(P.keyMove(i, dx, dy)));
  assert.equal(P.keyMove(0, 1, 0), 1);
  assert.equal(P.keyMove(0, -1, 0), P.KEY_COLS - 1, 'rows wrap');
  assert.equal(P.keyMove(0, 0, 1), P.KEY_COLS);
  // Down from the bottom letter row lands on the action row; up from it returns.
  const last = P.keyRows().at(-2)[0];
  assert.equal(P.keyAt(P.keyMove(last, 0, 1)).action, 'back');
  assert.equal(P.keyAt(P.keyMove(P.keyMove(last, 0, 1), 0, -1)).char, P.KEY_CHARS[last]);
});

const client = fs.readFileSync('coop-bubbles.js', 'utf8');
const clientBlock = vm.runInNewContext(client.match(/\/\* profiles-client:begin[\s\S]*?\/\* profiles-client:end \*\//)[0] + '; ({ newRoundRec, creditShots, creditPoints, roundResult })');

test('local rounds attribute shot points, share team bonuses, and report only profiles', () => {
  const { newRoundRec, creditShots, creditPoints, roundResult } = clientBlock;
  const players = [0, 1, 2].map(() => ({ rec: newRoundRec() }));
  creditShots(players, [{ shooter: 0, bubbles: [1, 2, 3] }, { shooter: 1, bubbles: [1] }], 400, 2);
  creditPoints(players, [0, 1], 100);
  assert.equal(players[0].rec.score, 350); assert.equal(players[1].rec.score, 150);
  assert.equal(players[0].rec.biggestPop, 3); assert.equal(players[0].rec.bestChain, 2);
  const ids = [{ type: 'profile', id: 'p-justin' }, { type: 'guest' }, null];
  const result = roundResult({ id: 'round-abcdefgh', mode: 'clear', campaign: 'coop2', level: 4, won: true, secs: 61.4, teamScore: 1100,
    players: players.map((p, i) => ({ ...p, ident: ids[i], bombsLeft: 2 })) });
  assert.equal(result.players.length, 1, 'the Guest and the bot are never reported');
  assert.equal(result.players[0].profileId, 'p-justin');
  // 1100 team − 500 attributed = 600 shared three ways.
  assert.equal(result.players[0].score, 350 + 200);
  assert.equal(result.secs, 61);
  assert.doesNotThrow(() => P.cleanRound(result, c => c === 'coop2' ? 52 : 0));
  assert.equal(roundResult({ id: 'round-abcdefgh', mode: 'clear', teamScore: 10, players: [{ ident: { type: 'guest' }, rec: newRoundRec() }] }), null,
    'an all-Guest round never reaches the server');
});

test('the client wires Player Select, Player Stats, retries, and Guest labels', () => {
  assert.match(client, /class="btn ghost playerStatsOpen"/, 'main menu entry');
  assert.match(client, /This will permanently remove this player's saved progress and statistics\./);
  assert.match(client, /CoopProfiles\.NAME_TAKEN/);
  assert.match(client, /'\/profiles\/results'/);
  assert.match(client, /bt_round_queue/);
  assert.match(client, /\.name \+ ' · Guest'/, 'Guests are labelled as such on their launcher');
  // Pads only steer the panel of the launcher they drive.
  assert.match(client, /profilePadInput\(n, axis, d, hit\) \{\s*const i = this\.padHuman\(n\)/);
  // A side pick hands over to Player Select rather than straight to the tutorial.
  assert.match(client, /finishPadPick[\s\S]{0,400}this\.openProfilePick\(\)/);
});
