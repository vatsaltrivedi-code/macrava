// Nov 2026 changes: mess meals in Adjust, bread only with a kitchen, "Change my answers" leads back to the plan,
// more mess-plate foods, and "Another plan" options at about the same price.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait, root } = require('./helpers');
const { ok, done } = reporter();
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'vendor/solver.js'), 'utf8'), ctx);
const { planDay, altOptions, canMake } = require(path.join(root, 'plan.js'));
const foods = JSON.parse(fs.readFileSync(path.join(root, 'foods.json'), 'utf8')); foods.forEach((f, i) => f.id = i);
const PLAN = (o) => Object.assign({ diet: 'nonveg', kitchen: false, place: 'hostel', meals: 2, step: 4, city: 'Delhi NCR', budget: 200, guest: true }, o);
async function open(b, o) {
  const p = await newDevice(b, makeStore());
  await p.addInitScript((st) => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('mbp', JSON.stringify(st)); } }, PLAN(o));
  await p.goto(APP); await wait(300); if (await p.$('#guest')) { await p.click('#guest'); await wait(1200); }
  return p;
}
const state = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('mbp')));
const names = (p) => p.$$eval('ul.foods li .fname .n', els => els.map(e => e.innerText));
(async () => {
  const bread = foods.filter(f => f.cat === 'Bread');
  ok(bread.length > 0 && bread.every(f => !canMake(f, { kettle: true, microwave: true, fridge: true })), 'no-kitchen rooms never get bread, even with every gadget');
  const base = { budget: 200, protein: 110, kcal: 2200, diet: 'nonveg', style: 'balanced', breakfast: true, have: { p: 0, kcal: 0, c: 0, f: 0 } };
  const hostel = planDay(foods, Object.assign({}, base, { kitchen: false }), ctx.solver);
  ok(hostel.ok && !hostel.items.some(it => it.food.cat === 'Bread'), 'hostel plan has no bread');
  ok(planDay(foods, Object.assign({}, base, { kitchen: false, include: [{ id: bread[0].id, g: 60 }] }), ctx.solver).items.some(it => it.food.cat === 'Bread'), 'bread the person picks still stays');
  const kit = planDay(foods, Object.assign({}, base, { kitchen: true }), ctx.solver);
  ok(kit.ok, 'kitchen plan works');
  const a1 = altOptions(foods, Object.assign({}, base, { kitchen: true }), ctx.solver, 1);
  ok(a1.penalty && a1.budget <= 200, 'option 2 exists for a kitchen plan');
  const p2 = planDay(foods, Object.assign({}, base, { kitchen: true, penalty: a1.penalty, budget: a1.budget }), ctx.solver);
  const ids = (x) => x.items.map(i => i.food.id).sort().join();
  ok(ids(p2) !== ids(kit), 'option 2 uses different foods');
  ok(p2.totals.p >= 110 - 0.5 && p2.totals.cost <= Math.max(kit.totals.cost * 1.08, kit.totals.cost + 5) + 1, `option 2 hits protein at about the same price (₹${kit.totals.cost.toFixed(0)} → ₹${p2.totals.cost.toFixed(0)})`);

  build(null);
  const b = await chromium.launch();
  try {
    { const p = await open(b, {});
      await p.click('#adjustBtn'); await wait(200);
      ok((await p.$$('[data-meals]')).length === 4, 'Adjust has a mess meals row');
      ok(await p.$eval('[data-meals="2"]', e => e.getAttribute('aria-pressed')) === 'true', 'it shows the saved answer');
      await p.click('[data-meals="3"]'); await wait(1500);
      ok((await state(p)).meals === 3, 'changing it saves');
      ok(!(await p.$eval('#adjust', e => e.hidden)), 'sheet stays open while the plan updates');
      ok((await p.$$('[data-plate]')).length === 3, 'plan now shows 3 mess meals');
      ok(!(await names(p)).some(n => /bread/i.test(n)), 'hostel plan on screen has no bread');
      await p.click('#adjX'); await p.click('[data-plate="Lunch"]'); await wait(150);
      const n = (await p.$$('[data-pl-inc]')).length;
      ok(n === 29, 'non-veg sees 29 mess foods (' + n + ')');
      ok((await p.$$('.pl-grp')).length === 5, 'mess foods are grouped');
      await p.click('[data-pl-inc="soya"]'); await p.click('[data-pl-inc="roti"]'); await p.click('[data-pl-inc="roti"]');
      ok(/≈ 18 g protein/.test(await p.$eval('.pl-tot', e => e.innerText)), 'soya curry + 2 roti = 18 g');
      await p.click('#plSave'); await wait(300);
      ok(/soya chunk curry/.test(await p.$eval('[data-plate="Lunch"]', e => e.closest('li').innerText)), 'saved plate names the new food');
      ok(p.errors.length === 0, 'no page errors: ' + p.errors.join('; '));
    }
    { const p = await open(b, { diet: 'veg' });
      await p.click('[data-plate="Lunch"]'); await wait(150);
      const keys = await p.$$eval('[data-pl-inc]', els => els.map(e => e.dataset.plInc));
      ok(!keys.some(k => ['egg', 'omelette', 'chicken', 'biryani', 'fish'].includes(k)) && keys.length === 24, 'veg sees no egg, chicken or fish (' + keys.length + ')');
    }
    { const p = await open(b, { diet: 'egg' });
      await p.click('[data-plate="Lunch"]'); await wait(150);
      const keys = await p.$$eval('[data-pl-inc]', els => els.map(e => e.dataset.plInc));
      ok(keys.includes('omelette') && !keys.includes('fish') && !keys.includes('biryani'), 'veg + eggs sees eggs, not meat');
    }
    { const p = await open(b, {});
      await p.click('[data-tab="you"]'); await wait(200);
      await p.click('#restart'); await wait(300);
      ok(!!(await p.$('#toPlan')), 'question 1 offers "Show my updated plan"');
      await p.click('.opt[data-v="veg"]'); await wait(400);
      ok(!!(await p.$('#toPlan')) && (await state(p)).step === 0, 'picking a diet does not jump ahead');
      await p.click('#next'); await wait(300);
      ok((await state(p)).step === 1 && !!(await p.$('#toPlan')), '"Next question" goes on, still with the shortcut');
      await p.click('[data-n="1"]');
      await p.click('#toPlan'); await wait(1500);
      const st = await state(p);
      ok(st.step === 4 && st.diet === 'veg' && st.meals === 1, 'back on the plan with the new answers');
      ok(await p.$eval('[data-tab="day"]', e => e.getAttribute('aria-selected')) === 'true', 'lands on Today');
      ok(p.errors.length === 0, 'no page errors: ' + p.errors.join('; '));
    }
    { const p = await open(b, { kitchen: true, place: 'home', budget: 200 });
      ok(/Plan option 1/.test(await p.$eval('.alt-bar', e => e.innerText)), 'plan shows option 1');
      const before = (await names(p)).join('|');
      await p.click('#altNext'); await wait(3000);
      const bar = await p.$eval('.alt-bar', e => e.innerText);
      ok(/Plan option 2/.test(bar) && /option 1/.test(bar), 'option 2 shown with its price vs option 1 (' + bar.replace(/\n/g, ' ') + ')');
      ok((await names(p)).join('|') !== before, 'option 2 has different foods');
      ok(/Target reached/.test(await p.$eval('.hero', e => e.innerText)), 'option 2 still hits the target');
      ok((await state(p)).variant === 1, 'option is saved');
      await p.reload(); await wait(500); if (await p.$('#guest')) { await p.click('#guest'); }
      await p.waitForSelector('.alt-bar', { timeout: 15000 });
      ok(/Plan option 2/.test(await p.$eval('.alt-bar', e => e.innerText)), 'option survives a reload');
      await p.click('#altFirst'); await wait(1200);
      ok((await names(p)).join('|') === before, 'back to option 1 restores the first plan');
      ok(p.errors.length === 0, 'no page errors: ' + p.errors.join('; '));
    }
  } finally { await b.close(); }
  done();
})();
