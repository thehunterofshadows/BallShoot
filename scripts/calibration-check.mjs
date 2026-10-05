// Docker: docker compose run --rm --no-deps screens node scripts/calibration-check.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://calibration.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
  await page.goto('http://calibration.test/');
  for(const path of ['coop-objects.js','coop-campaigns.js','coop-bubbles.js'])await page.addScriptTag({path});
  await page.evaluate(()=>{
    window.pads=[0,1].map(index=>({index,id:'Test pad '+index,mapping:'standard',connected:true,axes:[0.05,0.02],buttons:Array.from({length:16},()=>({pressed:false}))}));
    Object.defineProperty(navigator,'getGamepads',{value:()=>window.pads});
    document.body.innerHTML='<coop-bubbles></coop-bubbles>';
  });
  const game=page.locator('coop-bubbles');
  await page.evaluate(()=>{const g=document.querySelector('coop-bubbles');g.sideEl.classList.add('open');g.calibrationEl.open=true;});
  await game.locator('[data-stick]').last().waitFor();
  assert.equal(await game.locator('[data-stick]').count(),2);
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
  await page.evaluate(()=>{window.pads=[];});
  await page.waitForTimeout(100);
  assert.match(await game.locator('.stickCards').textContent(),/No controllers/);
  assert.deepEqual(errors,[]);
  console.log('Calibration browser checks passed: live XY, radius, independent controls, timed sampling, navigation and disconnect.');
} finally {await browser.close();}
