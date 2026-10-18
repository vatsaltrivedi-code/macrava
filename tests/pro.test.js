// Basic vs Pro: Basic gets today's plan (swaps, readymade, price fixes); week, Shopping and restaurants show a Pro preview
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const PLAN = { diet: 'nonveg', kitchen: true, place: 'home', step: 4, city: 'Delhi NCR', budget: 200, guest: true };
const vis = (p, sel) => p.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight)).catch(() => false);
const panelText = (p) => p.$eval('#panel', e => e.innerText).catch(() => '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function open(b, store, pro) {
  const p = await newDevice(b, store);
  await p.addInitScript(([st, pro]) => { if (pro) window.__mbpPro = true;
    if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('mbp', JSON.stringify(st)); } }, [PLAN, pro]);
  await p.goto(APP); await wait(300);
  if (await p.$('#guest')) { await p.click('#guest'); await wait(700); }
  return p;
}
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    { const store = makeStore(); const p = await open(b, store, false);
      ok(await vis(p, '#tBudget') && await vis(p, '.foods'), 'basic: today plan shows');
      ok(/Today's cheapest plan\. Planning the rest of the week is part of Pro\./.test(await panelText(p)), 'basic: today hint');
      ok(await vis(p, '.swap[data-id]'), 'basic: Swap still available');
      ok(/Pro/.test(await p.$eval('[data-tab=shop]', e => e.innerText)), 'basic: Shopping tab has Pro badge');
      // another day -> Pro card, back to today -> meals
      await p.click('[data-day="2"]'); await wait(150);
      ok(/Pro coming soon/.test(await panelText(p)) && !(await p.$('#panel .foods')), 'basic: other day shows Pro coming soon, no foods');
      await p.click('[data-day="0"]'); await wait(150);
      ok(await vis(p, '#panel .foods'), 'basic: back to today shows meals');
      // Shopping -> Pro 'coming soon' card: no price question, no buttons
      await p.click('[data-tab=shop]'); await wait(150);
      ok(await p.$eval('#panel', e => e.innerText.trim()) === 'Pro coming soon' && !(await p.$('#copy')) && !(await p.$('.shop')), 'basic: Shopping shows only Pro coming soon');
            ok(!(await p.$('[data-pro]')) && store.pro.size === 0, 'basic: no answer buttons, nothing recorded');
      // Order in: restaurants Pro, readymade free
      await p.click('[data-tab=out]'); await wait(150);
      ok(/Pro coming soon/.test(await panelText(p)) && !(await p.$('[data-chain]')), 'basic: restaurants show Pro coming soon');
      await p.click('[data-src=lic]'); await wait(150);
      ok(!!(await p.$('[data-lic]')) && !/part of Pro/.test(await panelText(p)), 'basic: readymade picks still free');
      ok(!(await p.$('#panel a[href*="licious"]')) && (await p.$$eval('#panel .store-name', e => e.map(x => x.innerText))).every(x => x === 'Licious'), 'readymade: plain "Licious" text, no links');
      // Today price fix
      await p.click('[data-tab=day]'); await wait(150);
      await p.click('#panel .pe'); await wait(100);
      ok(await vis(p, '#pIn'), 'basic: tapping a price on Today opens the editor');
      ok((await p.$$('#pIn')).length === 1, 'editor shown once even if the food is in two meals');
      await p.fill('#pIn', '0'); await p.click('#pSave'); await wait(50);
      ok(/Enter the price of one pack/.test(await p.$eval('#pErr', e => e.innerText)), 'price 0 refused');
      const base = await p.$eval('#pIn', e => e.value);
      await p.fill('#pIn', String(Math.round(+base * 1.1) || 50)); await p.click('#pSave'); await wait(600);
      ok(/your price/.test(await panelText(p)), 'saved price marked "your price" on Today');
      ok(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mbp')).myPrices || {}).length === 1), 'price saved in the plan');
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
      ok(p.errors.length === 0, 'basic: no errors ' + p.errors.join('|'));
      await p.context().close(); }

    { const store = makeStore(); const p = await open(b, store, true);
      await p.click('[data-day="2"]'); await wait(150);
      ok(await vis(p, '#panel .foods') && !/part of Pro|coming soon/.test(await panelText(p)), 'pro: other days show plans');
      ok(!/Pro/.test(await p.$eval('[data-tab=shop]', e => e.innerText)), 'pro: no badge');
      await p.click('[data-tab=shop]'); await wait(150);
      ok(!!(await p.$('#copy')) && !!(await p.$('.shop')), 'pro: shopping list');
      await p.click('[data-tab=out]'); await wait(150);
      ok(!!(await p.$('[data-chain]')), 'pro: restaurants');
      ok(p.errors.length === 0, 'pro: no errors ' + p.errors.join('|'));
      await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
