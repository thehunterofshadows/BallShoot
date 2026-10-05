/* Browser check for issue #18's Player Select, on-screen name entry and Player Stats, against
   the real profile store (server/profiles.js) behind the same /profiles routes nginx proxies.
   Run: docker compose run --rm --no-deps screens node scripts/profiles-probe.mjs */
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const P = require(join(root, 'coop-profiles.js'));
// The probe container has no `ws`; the store only needs the shared rules and level counts.
const store = { profiles: new Map(), rounds: new Set(), stats: new Map() };
const types = { '.html':'text/html', '.js':'text/javascript', '.webp':'image/webp' };
const json = (res, code, body) => { res.writeHead(code, { 'content-type':'application/json' }); res.end(JSON.stringify(body)); };
const posted = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'profiles') {
    let body = ''; for await (const c of req) body += c; const data = body ? JSON.parse(body) : {};
    if (req.method === 'GET' && !parts[1]) return json(res, 200, { profiles: [...store.profiles.values()] });
    if (req.method === 'POST' && !parts[1]) {
      try { const name = P.cleanName(data.name); if ([...store.profiles.values()].some(p => P.nameKey(p.name) === P.nameKey(name))) return json(res, 409, { code:'name_taken', message:P.NAME_TAKEN });
        const p = { id:'id-' + name.toLowerCase(), name, createdAt:Date.now(), score:0, levelsCompleted:0 }; store.profiles.set(p.id, p); return json(res, 201, { profile:p }); }
      catch (e) { return json(res, 400, { code:e.code, message:e.message }); }
    }
    if (req.method === 'POST' && parts[1] === 'results') {
      const r = P.cleanRound(data, () => 52); posted.push(r);
      const duplicate = store.rounds.has(r.roundId); store.rounds.add(r.roundId);
      return json(res, 200, { duplicate, profiles: [] });
    }
    if (req.method === 'GET' && parts[1]) {
      const p = store.profiles.get(parts[1]); if (!p) return json(res, 404, { code:'not_found' });
      return json(res, 200, { profile:p, stats:{ score:1234, rounds:3, wins:2, levelsCompleted:1, bestChain:3, biggestPop:9, popped:120, bombsUsed:2, bombsSaved:4, fusions:1, playSecs:400 },
        campaigns:{ original:{ name:'Original 52', total:52, completed:1, highest:19, levels:{ 19:{ completed:true } } }, coop2:{ name:'Bubble Together 2', total:52, completed:0, highest:-1, levels:{} } },
        partners:[{ id:'id-amy', name:'Amy', rounds:3, wins:2, levelsTogether:1, bestTeamScore:4000, fusions:1, playSecs:400 }] });
    }
    return json(res, 405, {});
  }
  const name = url.pathname.slice(1) || 'index.html';
  try { const b = await readFile(join(root, name)); res.writeHead(200, { 'content-type':types[extname(name)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ args:['--no-sandbox'] });
const fail = (msg, extra) => { throw new Error(msg + ' ' + JSON.stringify(extra || {})); };
try {
  await mkdir(join(root, 'screenshots'), { recursive:true });
  for (const display of ['desktop', 'tv']) {
    const context = await browser.newContext({ viewport:{ width:1920, height:1080 } });
    await context.addInitScript(d => { localStorage.setItem('bt_prefs', JSON.stringify({ displayMode:d })); Object.defineProperty(navigator, 'getGamepads', { value: undefined }); }, display);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil:'load' });
    await page.waitForFunction(() => document.querySelector('coop-bubbles')?.settings?.players);
    const game = page.locator('coop-bubbles');
    store.profiles.clear(); store.profiles.set('id-amy', { id:'id-amy', name:'Amy', createdAt:Date.now(), score:500, levelsCompleted:1 });
    await game.locator('.localCoopPlay').click();
    await game.locator('.ppPanel').first().waitFor();
    if (await game.locator('.ppPanel').count() !== 2) fail('two panels expected');
    // Left: keyboard types a new name, which collides case-insensitively, then fixes it.
    await game.locator('.ppPanel').nth(0).locator('[data-act="new"]').click();
    await page.keyboard.type('amy'); await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const dupText = await game.locator('.ppPanel').nth(0).locator('.ppError').textContent();
    if (dupText !== P.NAME_TAKEN) fail('duplicate prompt', { dupText });
    for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type('Justin'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('coop-bubbles')._pp?.panels[0].view === 'ready', null, { timeout: 3000 }).catch(async () => fail('left not ready', await page.evaluate(() => { const g = document.querySelector('coop-bubbles'); return { pp: g._pp, state: g.state, menu: g.menuRoot()?.className }; })));
    // Right: on-screen keys only (touch/click): B, O, Backspace, B, Confirm -> "B" exists? make "Bo".
    await game.locator('.ppPanel').nth(1).locator('[data-act="new"]').click();
    const key = async ch => game.locator('.ppPanel').nth(1).locator('.ppKey', { hasText: new RegExp('^' + ch + '$') }).click();
    await key('B'); await key('O'); await key('X'); await game.locator('.ppPanel').nth(1).locator('.ppKey.back').click();
    if (display === 'tv') await page.screenshot({ path:join(root, 'screenshots', 'profiles-pick-tv.png') });
    await game.locator('.ppPanel').nth(1).locator('.ppKey.ok').click();
    await page.waitForFunction(() => document.querySelector('coop-bubbles')._pp?.panels[1].view === 'ready');
    const chosen = await page.evaluate(() => document.querySelector('coop-bubbles')._pp.panels.map(p => p.choice.name));
    if (chosen.join() !== 'Justin,BO') fail('names', { chosen });
    if (display === 'desktop') await page.screenshot({ path:join(root, 'screenshots', 'profiles-pick-desktop.png') });
    await game.locator('.ppStart').click();
    await game.locator('.start').click();
    const labels = await page.evaluate(() => document.querySelector('coop-bubbles').players.map(p => p.name));
    if (labels.join() !== 'Justin,BO') fail('launcher labels', { labels });
    // Clear the board and check the round goes to the server with both profiles.
    await page.evaluate(() => { const g = document.querySelector('coop-bubbles'); g.score = 1500; g.players[0].rec.score = 400; g.grid = new Map(); g.batch = []; g.resolveBatch(); });
    await page.waitForFunction(() => /saved/.test(document.querySelector('coop-bubbles').shadowRoot.querySelector('.saveNote').textContent));
    const last = posted.at(-1);
    if (!last || last.players.length !== 2 || !last.won || last.level !== 0 || last.campaign !== 'coop2') fail('posted round', { last });
    // Retry of the same round is acknowledged as duplicate and the queue drains.
    await page.evaluate(r => { const g = document.querySelector('coop-bubbles'); g.roundQueue().push(r); return g.flushRounds(); }, last);
    if (await page.evaluate(() => document.querySelector('coop-bubbles').roundQueue().length)) fail('queue drained');
    // Player Stats from the home menu.
    await page.evaluate(() => document.querySelector('coop-bubbles').returnHome());
    await game.locator('.playerStatsOpen').click();
    await game.locator('.psPick', { hasText:'Justin' }).click();
    await game.locator('.psTiles').waitFor();
    if (display === 'tv') await page.screenshot({ path:join(root, 'screenshots', 'profiles-stats-tv.png') });
    await game.locator('[data-ps="delete"]').click();
    const warn = await game.locator('.psWarn').textContent();
    if (!/Delete Justin\? This will permanently remove this player's saved progress and statistics\./.test(warn)) fail('delete wording', { warn });
    await game.locator('[data-ps="cancelDelete"]').click();
    if (errors.length) fail('page errors', { errors });
    console.log(`${display}: Player Select (keyboard + on-screen), duplicate prompt, round save + retry, Player Stats ok`);
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
