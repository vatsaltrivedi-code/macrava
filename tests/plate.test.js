// Mess plate logging: what's on the plate replaces the usual thali estimate for today
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const PLAN = (diet) => ({ diet, kitchen: true, place: 'hostel', meals: 3, step: 4, city: 'Delhi NCR', budget: 150, guest: true });
const num = (s) => +String(s).match(/[\d.]+/)[0];
async function open(b, diet) {
  const store = makeStore(); const p = await newDevice(b, store);
  await p.addInitScript((st) => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('mbp', JSON.stringify(st)); } }, PLAN(diet));
  await p.goto(APP); await wait(300); if (await p.$('#guest')) { await p.click('#guest'); await wait(800); }
  return p;
}
const state = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('mbp')));
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    { const p = await open(b, 'nonveg');
      ok((await p.$$('[data-plate]')).length === 3, 'each mess meal has a plate button');
      const head = () => p.$eval('h3.meal:has(+ ul li [data-plate="Dinner"]), h3.meal', e => e.innerText);
      await p.click('[data-plate="Dinner"]'); await wait(150);
      ok(!!(await p.$('.plate-ed')), 'plate editor opens');
      ok((await p.$$('[data-pl-inc]')).length === 12, 'non-veg sees all 12 items');
      ok(await p.$eval('[data-pl-dec="roti"]', e => e.disabled), 'minus is disabled at zero');
      for (const k of ['roti', 'roti', 'roti', 'dal', 'egg']) await p.click(`[data-pl-inc="${k}"]`);
      ok(/≈ 21 g protein/.test(await p.$eval('.pl-tot', e => e.innerText)), 'running total: 3 roti + dal + egg = 21 g');
      await p.click('#plSave'); await wait(300);
      const st = await state(p); const d = Object.keys(st.plates)[0];
      ok(JSON.stringify(st.plates[d].Dinner) === '{"roti":3,"dal":1,"egg":1}', 'plate saved for today');
      ok(st.ate[d].includes('Dinner:mess'), 'saving a plate ticks the meal as eaten');
      const row = await p.$eval('[data-plate="Dinner"]', e => e.closest('li').innerText);
      ok(/≈21g protein/.test(row) && /3 roti, dal, 1 egg/.test(row) && /Edit plate/.test(row), 'row shows the plate (' + row.replace(/\n/g, ' | ') + ')');
      ok(/^21 /.test(await p.$eval('.eaten b', e => e.innerText)), 'eaten today counts the plate');
      ok(/6 g more protein/.test(await p.$eval('.gap-note', e => e.innerText)), 'more than the estimate is noted');
      // a small lunch: suggest a top-up
      await p.click('[data-plate="Lunch"]'); await p.click('[data-pl-inc="rice"]'); await p.click('#plSave'); await wait(300);
      const gap = await p.$eval('.gap-note', e => e.innerText);
      ok(/about 5 g less protein/.test(gap) && /To make it up, add about/.test(gap) && /₹/.test(gap), 'less than expected: top-up suggested (' + gap + ')');
      // edit and clear
      await p.click('[data-plate="Lunch"]'); await wait(100);
      ok(await p.$eval('[data-pl-inc="rice"]', e => e.parentElement.querySelector('b').innerText) === '1', 'editing starts from the saved plate');
      await p.click('#plClear'); await wait(200);
      ok(!(await state(p)).plates[d].Lunch && !!(await state(p)).plates[d].Dinner, 'use the usual estimate removes only that plate');
      // cancel keeps nothing
      await p.click('[data-plate="Breakfast"]'); await p.click('[data-pl-inc="milk"]'); await p.click('#plCancel'); await wait(150);
      ok(!(await state(p)).plates[d].Breakfast && !(await p.$('.plate-ed')), 'cancel saves nothing');
      // a plate from an earlier day is ignored today
      await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mbp')); s.plates = { '2000-01-01': { Lunch: { chicken: 5 } } }; localStorage.setItem('mbp', JSON.stringify(s)); });
      await p.reload(); await wait(300); if (await p.$('#guest')) { await p.click('#guest'); await wait(800); }
      ok(/What's on your plate\?/.test(await p.$eval('[data-plate="Lunch"]', e => e.innerText)) && !(await p.$('.gap-note')), 'old plates do not count today');
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
      ok(p.errors.length === 0, 'no errors ' + p.errors.join('|'));
      await p.context().close(); }

    { const p = await open(b, 'veg');
      await p.click('[data-plate="Lunch"]'); await wait(100);
      const items = await p.$$eval('[data-pl-inc]', e => e.map(x => x.dataset.plInc));
      ok(!items.includes('egg') && !items.includes('chicken') && items.includes('paneer'), 'veg: no egg or chicken on the list');
      await p.context().close(); }

    { const p = await open(b, 'egg');
      await p.click('[data-plate="Lunch"]'); await wait(100);
      const items = await p.$$eval('[data-pl-inc]', e => e.map(x => x.dataset.plInc));
      ok(items.includes('egg') && !items.includes('chicken'), 'egg diet: egg yes, chicken no');
      await p.context().close(); }

    // Saved data is untrusted: bad plates are dropped
    { const store = makeStore(); const p = await newDevice(b, store);
      await p.goto(APP); await wait(300);
      const c = await p.evaluate(() => window.__mbpTest.clean({ plates: { '2026-10-19': { Lunch: { roti: 3, hack: 2, dal: -1, rice: 99 }, Snack: { roti: 1 }, Dinner: '<img>' }, 'bad-date': { Lunch: { roti: 1 } } } }).plates);
      ok(JSON.stringify(c) === '{"2026-10-19":{"Lunch":{"roti":3,"rice":10}}}', 'clean keeps only known items, meals and dates (' + JSON.stringify(c) + ')');
      await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
