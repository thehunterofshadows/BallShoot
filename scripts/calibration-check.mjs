// Docker: docker compose run --rm --no-deps screens node scripts/calibration-check.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1920,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://calibration.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}coop-bubbles{display:block;width:100%;height:100%}</style><body></body>'}));
  await page.goto('http://calibration.test/');
  for(const path of ['coop-objects.js','coop-campaigns.js','coop-bubbles.js'])await page.addScriptTag({path});
  await page.evaluate(()=>{
    window.pads=[0,1].map(index=>({index,id:'Test pad '+index,mapping:'standard',connected:true,axes:[0.05,0.02],buttons:Array.from({length:16},()=>({pressed:false}))}));
    Object.defineProperty(navigator,'getGamepads',{value:()=>window.pads});
    document.body.innerHTML='<coop-bubbles></coop-bubbles>';
  });
  const game=page.locator('coop-bubbles');
  await page.evaluate(()=>{const g=document.querySelector('coop-bubbles');g.settings.displayMode='desktop';g.measure();});
  await game.locator('.calibration summary').click();
  assert.equal(await page.evaluate(()=>document.querySelector('coop-bubbles').sideEl.classList.contains('open')),false);
  await page.waitForFunction(()=>{const g=document.querySelector('coop-bubbles');return g.menuRoot()===g.calibrationEl;});
  await game.locator('[data-stick]').last().waitFor();
  assert.equal(await game.locator('[data-stick]').count(),2);
  await page.evaluate(()=>{const g=document.querySelector('coop-bubbles');g.shadowRoot.activeElement?.blur();window.pads[0].buttons[13].pressed=true;});
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>{const g=document.querySelector('coop-bubbles');return g.calibrationEl.contains(g.shadowRoot.activeElement);}),true);
  await page.evaluate(()=>{window.pads[0].buttons[13].pressed=false;});
  const range=game.locator('[data-stick="0"] input');
  await range.fill('10');await range.dispatchEvent('input');
  assert.equal(await game.locator('[data-stick="0"] .stickZone').getAttribute('r'),'10');
  assert.equal(await game.locator('[data-stick="1"] input').inputValue(),'18');
  await game.locator('[data-stick="0"] button').click();
  await page.waitForTimeout(3700);
  assert.match(await game.locator('[data-stick="0"] .stickResult').textContent(),/Applied 10% → 8%/);
  // Stick movement must not navigate away or adjust sliders on the calibration screen.
  await page.evaluate(()=>{window.pads[0].axes=[1,0];});
  await page.waitForTimeout(500);
  assert.equal(await range.inputValue(),'8');
  // A collapsed drawer retains expanded details. Reopening must release online input.
  await page.setViewportSize({width:800,height:900});
  await page.waitForTimeout(100);
  for (const opener of ['gear', 'controller']) {
    await page.evaluate(()=>{
      const g=document.querySelector('coop-bubbles');g.closeSide();
      g.online=true;g.setOnlineAnalog(0.8);g.setOnlineHeld('r',true);
    });
    if (opener==='gear') await game.locator('.gear').click();
    else await page.evaluate(()=>{window.pads[0].buttons[8].pressed=true;});
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(()=>{
      const g=document.querySelector('coop-bubbles');
      return {visible:g.calibrationOpen(),held:g._onlineHeld};
    }),{visible:true,held:{l:false,r:false,analog:0}});
    await page.evaluate(()=>{window.pads[0].buttons[8].pressed=false;});
    await page.waitForTimeout(50);
  }
  await page.evaluate(()=>{window.pads=[];});
  await page.waitForTimeout(100);
  assert.match(await game.locator('.stickCards').textContent(),/No controllers/);
  assert.deepEqual(errors,[]);
  console.log('Calibration browser checks passed: wide sidebar, D-pad navigation, drawer reopening input release, live XY, radius, independent controls, timed sampling and disconnect.');
} finally {await browser.close();}
