/* Renders the fantasy-arcade cabinet (#11) across the layouts it has to survive — 2/3/4
   players, a scrolled wide field, a 1560-tall view, battle, danger, TV and a run where every
   theme image fails — and checks that all seven theme assets actually loaded.
   Run: docker compose run --rm --no-deps screens node scripts/theme-probe.mjs */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'screenshots', 'theme');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.webp':'image/webp', '.json':'application/json' };
const THEME = ['fantasy-night', 'playfield-glass', 'frame-top', 'frame-left', 'frame-right', 'frame-bottom', 'launcher-deck'];

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  const file = path === '/' ? 'index.html' : path.slice(1);
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await mkdir(outDir, { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
let failed = false;

const CASES = [
  { name:'desktop-2p',      vp:[1440, 900], players:2 },
  { name:'desktop-3p',      vp:[1440, 900], players:3 },
  { name:'desktop-4p',      vp:[1440, 900], players:4 },
  { name:'tall-2p',         vp:[344, 882],  players:2 },
  { name:'tall-4p',         vp:[344, 882],  players:4 },
  { name:'narrow-3p',       vp:[412, 960],  players:3 },
  { name:'desktop-wide',    vp:[1440, 900], players:2, field:'wide', camX:900 },
  { name:'desktop-danger',  vp:[1440, 900], players:2, danger:true },
  { name:'desktop-battle',  vp:[1440, 900], players:4, mode:'battle' },
  { name:'battle-minis',    vp:[1440, 900], players:4, mode:'battle', zoom:true },
  { name:'desktop-fallback',vp:[1440, 900], players:2, blockTheme:true },
  { name:'tall-fallback',   vp:[344, 882],  players:3, blockTheme:true },
  { name:'tv-2p',           vp:[1600, 900], players:2, tv:true },
];

for (const c of CASES) {
  const context = await browser.newContext({ viewport: { width: c.vp[0], height: c.vp[1] }, deviceScaleFactor: 1 });
  if (c.tv) await context.addInitScript(() => localStorage.setItem('bt_prefs', JSON.stringify({ displayMode: 'tv' })));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const themeHits = new Set();
  page.on('requestfinished', r => { const m = r.url().match(/assets\/theme\/([\w-]+)\.webp/); if (m) themeHits.add(m[1]); });
  if (c.blockTheme) await page.route(/assets\/theme\//, route => route.abort());
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width > 0, null, { timeout: 15000 });
  await page.evaluate(c => {
    const g = document.querySelector('coop-bubbles');
    g.settings.players = c.players; g.settings.human = [true, false, false, false];
    if (c.field) g.settings.field = c.field;
    if (c.mode) g.settings.mode = c.mode;
    g.resetGame();
  }, c);
  const game = page.locator('coop-bubbles');
  await game.locator('.localPlay').click(); await page.evaluate(() => { const g = document.querySelector('coop-bubbles'); if (g._padPickActive) g.finishPadPick(true); if (g._profilePickActive) { g._pp.panels.forEach(p => { p.choice = { type: 'guest' }; p.view = 'ready'; }); g.ppStart(); } }); // Player Select (#18): everyone as Guest
  await game.locator('.start').click();
  await page.waitForTimeout(900);
  const probe = await page.evaluate(c => {
    const g = document.querySelector('coop-bubbles');
    if (c.camX !== undefined) { g.camX = c.camX; g.activeP = -1; }
    if (c.danger) g.danger = { t: 3.2 };
    if (c.zoom) g.battle.zoom = 1; // the board picker, where the mini boards are drawn
    g.state = 'paused'; // freeze the frame so the forced camera / danger state is what renders
    return { H: g.H, deck: !!g.deckFit() };
  }, c);
  await page.waitForTimeout(200);
  const loaded = await page.evaluate(ids => Promise.all(ids.map(id => new Promise(res => {
    const img = new Image(); img.onload = () => res(img.naturalWidth > 0); img.onerror = () => res(false);
    img.src = `assets/theme/${id}.webp`; }))), THEME);
  await page.screenshot({ path: join(outDir, `${c.name}.png`) });
  const allLoaded = loaded.every(Boolean);
  const requested = THEME.filter(n => themeHits.has(n));
  console.log(`${c.name.padEnd(18)} viewH ${probe.H}  deck ${probe.deck ? 'yes' : 'no '}  theme requests ${requested.length}/7` +
    `${c.blockTheme ? ' (blocked)' : ''}${errors.length ? '  !! ' + errors.join(' | ') : ''}`);
  if (errors.length) failed = true;
  if (!c.blockTheme && (!allLoaded || requested.length !== THEME.length)) { console.error(`  theme assets missing: ${THEME.filter(n => !themeHits.has(n))}`); failed = true; }
  if (c.players === 2 && !c.field && !c.mode && !c.blockTheme && !probe.deck) { console.error('  two-player classic did not use the deck'); failed = true; }
  if (c.players > 2 && probe.deck) { console.error('  deck forced onto a 3/4-player layout'); failed = true; }
  await context.close();
}

await browser.close();
server.close();
if (failed) process.exitCode = 1;
