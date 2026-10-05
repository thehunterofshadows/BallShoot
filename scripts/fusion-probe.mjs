// Offline component presentation check for #17. Mount the real web component directly
// so CDN availability in the generated support bootstrap cannot hide a rendering failure.
// Run: docker compose run --rm --no-deps screens node scripts/fusion-probe.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.webp':'image/webp', '.json':'application/json' };
const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  const file = path === '/' ? 'index.html' : path.slice(1);
  try {
    const body = file === 'index.html' ? `<!doctype html><html><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>html,body{margin:0;width:100%;height:100%;overflow:hidden}coop-bubbles{display:block;width:100%;height:100%}</style>
      <script src="/coop-objects.js"></script><script src="/coop-campaigns.js"></script><script src="/coop-profiles.js"></script>
      <script src="/coop-bubbles.js"></script></head><body><coop-bubbles></coop-bubbles></body></html>`
      : await readFile(join(root, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(join(root,'screenshots'),{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox']});
try {
 for(const tv of [false,true]) {
  const page=await browser.newPage({viewport:tv?{width:1920,height:1080}:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(tv=>{
   if(tv)localStorage.setItem('bt_prefs',JSON.stringify({displayMode:'tv'}));
   window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};
  },tv);
  await page.goto(base+'?perf',{waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width>0);
  await page.evaluate(()=>{
   const g=document.querySelector('coop-bubbles');g.settings.players=2;g.settings.human=[true,true,false,false];g.settings.hurry=0;g.settings.sound=false;g.settings.reload=0;g.resetGame();g.state='play';g.homeEl.style.display='none';g.hideOverlays();g.closeSide();g.syncSideScope();
   g.grid.clear();g.objects=[];g.batch=[];g.resolveAt=0;
   const put=(r,c,kind,special=null)=>g.grid.set(`${r},${c}`,{r,c,kind,special,placedBy:-1,at:0});
   for(let c=2;c<=11;c++)put(0,c,'R');
   for(let r=1;r<=7;r++)put(r,6,'GBY'[r%3]);
   for(let c=3;c<=10;c++)put(7,c,'B');
   g.updateLowest();g.teamPowerCharge=100;g.requestTeamPower(0);g.now+=.35;g.fxTick();g.syncTvHud();g.render();
  });
  await page.screenshot({path:join(root,'screenshots',`fusion-${tv?'tv':'desktop'}-armed.png`)});
  await page.evaluate(()=>{const g=document.querySelector('coop-bubbles');g.fire(0);const f=g.flights.pop();f.x=g.cellX(3,5);f.y=g.cellY(3);g.land(f);g.fxTick();g.syncTvHud();g.render();});
  await page.screenshot({path:join(root,'screenshots',`fusion-${tv?'tv':'desktop'}-waiting.png`)});
  const result=await page.evaluate(()=>{const g=document.querySelector('coop-bubbles');g.fire(1);const f=g.flights.pop();f.x=g.cellX(3,7);f.y=g.cellY(3);g.land(f);g.now+=1.1;g.fxTick();g.syncTvHud();g.render();return {phase:g.fusion.phase,moved:g.fusion.moved.length,label:g.fusionLabel()};});
  await page.screenshot({path:join(root,'screenshots',`fusion-${tv?'tv':'desktop'}-burst.png`)});
  if(errors.length||result.phase!=='burst'||!result.moved)throw Error(JSON.stringify({errors,result}));
  console.log(JSON.stringify({tv,...result,errors}));await page.close();
 }
} finally {await browser.close();server.close();}
