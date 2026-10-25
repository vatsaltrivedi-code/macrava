// Restaurant prices and links come only from the chains' own websites
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { APP, build, reporter, wait, root } = require('./helpers');
const { ok, done } = reporter();
const rest = JSON.parse(fs.readFileSync(path.join(root, 'rest.json'), 'utf8'));
const off = JSON.parse(fs.readFileSync(path.join(root, 'data/official_prices.json'), 'utf8'));
(async () => {
  // Data: one official price per row - Delhi NCR, except McDonald's West & South (read for Mumbai)
  const priced = rest.filter(r => r.prices);
  const cityFor = r => r.chain === "McDonald's" && r.region === 'WS' ? 'Mumbai' : 'Delhi NCR';
  ok(priced.length > 0 && priced.every(r => Object.keys(r.prices).join() === cityFor(r)), 'data: every price is one official price for its read city (' + priced.length + ' rows)');
  ok(!rest.some(r => r.chain === "McDonald's" && r.region === 'NE' && r.prices), "data: McDonald's North & East stays unpriced (no web menu)");
  for (const ch of ['KFC', "McDonald's", "Domino's", 'Pizza Hut', 'Burger King']) ok(priced.some(r => r.chain === ch), 'data: ' + ch + ' has prices');
  const foods = JSON.parse(fs.readFileSync(path.join(root, 'foods.json'), 'utf8'));
  ok(!foods.some(f => /swiggy|instamart/i.test(f.link + f.store)) && foods.every((f, i) => f.id === i), 'data: no Instamart/Swiggy foods, ids are positions');
  ok(new Set(foods.map(f => f.link || f.name + '|' + f.pack)).size === foods.length, 'data: every food has its own key');
  const html = fs.readFileSync(path.join(root, 'template2.html'), 'utf8');
  ok(!/swiggy/i.test(html), 'app: no Swiggy mention or link');
  const m = rest.find(r => r.name === 'Margherita (Medium hand tossed, half: 3 slices)');
  ok(m && m.prices['Delhi NCR'] === Math.round(off["Domino's"].medium.Margherita / 2), 'data: Domino\'s half-medium = half the menu price');

  build(null);
  const b = await chromium.launch();
  try {
    for (const [city, exact] of [['Delhi NCR', true], ['Mumbai', false]]) {
      const c = await b.newContext({ viewport: { width: 360, height: 780 } }); const p = await c.newPage(); const errs = [];
      p.on('pageerror', e => errs.push(e.message)); await p.route('**fonts.g*/**', r => r.abort());
      await p.addInitScript((city) => { window.__mbpTestHook = true; window.__mbpPro = true; localStorage.setItem('mbp', JSON.stringify({ diet: 'nonveg', kitchen: true, place: 'home', step: 4, city, budget: 200 })); }, city);
      await p.goto(APP); await wait(200); await p.click('#guest'); await wait(600);
      await p.click('[data-tab=out]'); await wait(300);
      const r = await p.evaluate(() => ({
        links: [...document.querySelectorAll('a.find')].map(a => a.getAttribute('href')),
        text: document.body.innerText }));
      ok(r.links.length > 0 && r.links.every(h => /^https:\/\/(online\.kfc\.co\.in|www\.mcdonaldsindia\.com|www\.dominos\.co\.in|www\.pizzahut\.co\.in|www\.burgerking\.in|www\.eatclub\.in)\//.test(h)), city + ': every link is a chain site (' + r.links.length + ')');
      ok(!/swiggy/i.test(r.text), city + ': no Swiggy on screen');
      ok(/Order from /.test(r.text), city + ': "Order from <chain>" shown');
      const tilde = /~\s*₹|≈\s*₹|₹\s*\d+\s*~/.test(r.text);
      ok(exact ? true : tilde, city + ': prices marked approximate outside Delhi NCR');
      ok(errs.length === 0, city + ': no errors ' + errs.join('|'));
      await c.close();
    }
  } finally { await b.close(); }
  done();
})();
