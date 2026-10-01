/* Browser smoke check for issue #4. Run in Docker:
   docker compose run --rm --no-deps screens node scripts/coop-objects-probe.mjs */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.webp':'image/webp'};
const server=createServer(async(req,res)=>{
  const name=(req.url||'/').split('?')[0].slice(1)||'index.html';
  try {const body=await readFile(join(root,name));res.writeHead(200,{'content-type':types[extname(name)]||'application/octet-stream'});res.end(body);}
  catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({args:['--no-sandbox']});
try {
  for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:280,height:650}]) {
    const context=await browser.newContext({viewport});
    const page=await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
    await page.waitForFunction(()=>document.querySelector('coop-bubbles')?.settings?.players);
    const state=await page.evaluate(()=>{
      const g=document.querySelector('coop-bubbles');
      g.settings.mode='clear';g.settings.players=2;g.settings.human=[true,true,false,false];
      const counts=[];
      for(const level of [47,48,49]) {
        g.settings.level=level;g.resetGame();g.render();counts.push(g.objects.length);
      }
      g.settings.level=47;g.resetGame();
      const shield=g.objects[0], [r,c]=shield.cells[0], x=g.cellX(r,c), y=g.cellY(r);
      g.land({x,y,p:0,kind:'R',special:null,at:g.now});
      const exposed=shield.state;
      g.land({x,y,p:1,kind:'R',special:null,at:g.now});
      g.render();
      return {counts,exposed,finished:shield.state,score:g.score,canvas:g.canvas.width,asset:!!globalThis.CoopObjects};
    });
    if(errors.length||!state.asset||state.counts.join()!=='2,2,3'||state.exposed!=='exposed'||state.finished!=='done'||state.score<150||!state.canvas)
      throw Error(`${viewport.width}x${viewport.height}: ${JSON.stringify({state,errors})}`);
    console.log(`${viewport.width}x${viewport.height}: objects rendered and local teamwork resolved`);
    await context.close();
  }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
