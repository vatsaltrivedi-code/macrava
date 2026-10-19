// Plan quantities: no food is ever shown as "0" of something, and tiny "sips" that add almost no protein are left out
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    // This setup used to show "0 bottle · 0g protein · ₹2"
    for (const diet of ['veg', 'nonveg']) {
      const p = await newDevice(b, makeStore());
      await p.addInitScript((st) => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('mbp', JSON.stringify(st)); } },
        { diet, kitchen: false, place: 'hostel', meals: 2, step: 4, city: 'Delhi NCR', budget: 120, guest: true });
      await p.goto(APP); await wait(300); if (await p.$('#guest')) { await p.click('#guest'); await wait(800); }
      const rows = await p.$$eval('ul.foods li:not(.mess)', e => e.map(x => ({ q: (x.querySelector('.qty') || {}).innerText || '', p: ((x.querySelector('.p') || {}).innerText || '') })).filter(r => r.q));
      ok(rows.length > 0, diet + ': plan shows foods');
      ok(rows.every(r => !/^0\b/.test(r.q)), diet + ': no quantity shown as 0 (' + rows.map(r => r.q.replace(/\n/g, ' ')).join(', ') + ')');
      ok(rows.every(r => !/^0g protein/.test(r.p)), diet + ': no food adding 0 g protein');
      ok(p.errors.length === 0, diet + ': no errors ' + p.errors.join('|'));
      await p.context().close();
    }
  } finally { await b.close(); }
  done();
})();
