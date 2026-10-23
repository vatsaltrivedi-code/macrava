// Protein quality and a proper breakfast: most protein from complete sources (dairy, eggs, soya, meat, whey),
// a breakfast of a base plus a protein food, and tiny budgets still get as much protein as possible.
const path = require('path'), fs = require('fs'), vm = require('vm');
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait, root } = require('./helpers');
const { ok, done } = reporter();
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'vendor/solver.js'), 'utf8'), ctx);
const { planDay, hq } = require(path.join(root, 'plan.js'));
const foods = JSON.parse(fs.readFileSync(path.join(root, 'foods.json'), 'utf8'));
const MESS = { p: 15, kcal: 650, c: 95, f: 22 };
const plan = (o, meals) => planDay(foods, Object.assign({ style: 'balanced', breakfast: meals < 3,
  have: { p: meals * MESS.p, kcal: meals * MESS.kcal, c: meals * MESS.c, f: meals * MESS.f } }, o), ctx.solver);
const share = (p) => p.totals.hq / p.totals.p;
(async () => {
  // Planner rules
  ok(hq(foods.find(f => /soya chunks/i.test(f.name))) && !hq(foods.find(f => /sattu/i.test(f.name))) && !hq(foods.find(f => f.cat === 'Protein bar'))
    && hq(foods.find(f => /whey/i.test(f.name))) && !hq(foods.find(f => /pea protein/i.test(f.name))), 'quality: soya and whey count, sattu, bars and pea protein do not');
  let p = plan({ budget: 250, protein: 140, kcal: 2600, diet: 'nonveg', kitchen: true }, 0);
  ok(p.ok && !p.budgetShort && share(p) >= 0.6 && p.quality === 0.65, 'home, ₹250: about two-thirds of protein is top quality (' + Math.round(100 * share(p)) + '%)');
  ok(p.items.some(it => it.food.cat === 'Bread' || it.food.cat === 'Oats & muesli') && p.items.some(it => ['Milk', 'Eggs', 'Curd', 'Yogurt', 'Cheese', 'Paneer & tofu', 'Dairy drink'].includes(it.food.cat)), 'home: plan carries a breakfast base and a breakfast protein');
  p = plan({ budget: 200, protein: 130, kcal: 2700, diet: 'nonveg', kitchen: false, gear: { kettle: true } }, 2);
  ok(p.ok && p.totals.p >= 125 && p.totals.cost <= 200.5 && share(p) >= 0.6, 'hostel with kettle, ₹200: target met with mostly top-quality protein (' + Math.round(100 * share(p)) + '%)');
  p = plan({ budget: 60, protein: 100, kcal: 2400, diet: 'veg', kitchen: false, gear: {} }, 2);
  ok(p.ok && p.totals.p >= 80 && p.totals.cost <= 60.5, 'tiny budget: still as much protein as the money buys (' + Math.round(p.totals.p) + ' g)');
  p = plan({ budget: 150, protein: 112, kcal: 2720, diet: 'egg', kitchen: false, gear: {} }, 2);
  ok(p.ok && p.totals.p >= 108 && p.totals.cost <= 150.5, 'hostel, no gear, ₹150: target met after rounding cups and bottles (' + Math.round(p.totals.p) + ' g, ₹' + Math.round(p.totals.cost) + ')');
  // App: breakfast is a base plus a protein food, never snacks; the quality line shows
  build(null);
  const b = await chromium.launch();
  try {
    const p2 = await newDevice(b, makeStore());
    await p2.addInitScript(() => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1);
      localStorage.setItem('mbp', JSON.stringify({ diet: 'egg', kitchen: false, place: 'hostel', gear: { kettle: true }, meals: 2, step: 4, budget: 200, guest: true })); } });
    await p2.goto(APP); await wait(300);
    if (await p2.$('#guest')) { await p2.click('#guest'); await wait(700); }
    const bf = await p2.evaluate(() => { const h = [...document.querySelectorAll('#panel .meal, #panel section, #panel div')].find(e => /^breakfast/i.test((e.querySelector('h3,h4,.mh,.meal-h') || {}).innerText || '')); return h ? h.innerText : document.querySelector('#panel').innerText; });
    const bfText = bf.split(/LUNCH|Lunch/)[0];
    ok(/bread|oats|muesli/i.test(bfText) && /egg|milk|curd|yogurt|dahi|lassi|cheese/i.test(bfText), 'app: breakfast has a base and a protein food');
    ok(!/sattu|namkeen|protein bar|bhujia|peanuts\b/i.test(bfText), 'app: no sattu, bars or namkeen at breakfast');
    ok(/% from top-quality protein/.test(await p2.$eval('.hero', e => e.innerText)), 'app: shows the share of top-quality protein');
    ok(p2.errors.length === 0, 'app: no errors ' + p2.errors.join('|'));
    await p2.context().close();
  } finally { await b.close(); }
  done();
})();
