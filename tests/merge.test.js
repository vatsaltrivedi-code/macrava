// Task 3: mergeState / trimForUpload / clean(updatedAt)
const { chromium } = require('playwright');
const { APP, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**fonts.g*/**', r => r.abort());
  await p.addInitScript(() => { window.__mbpTestHook = true; });
  await p.goto(APP); await wait(200);
  const r = await p.evaluate(() => {
    const { clean, mergeState, trimForUpload } = window.__mbpTest;
    const out = {};
    out.cleanKeepsStamp = clean({ updatedAt: 1234 }).updatedAt;
    out.cleanBadStamp = clean({ updatedAt: '<x>' }).updatedAt;
    const L = clean({ budget: 300, updatedAt: 2 }), R = clean({ budget: 150, updatedAt: 1 });
    out.localNewer = mergeState(L, R).budget;
    out.remoteNewer = mergeState(clean({ budget: 300, updatedAt: 1 }), clean({ budget: 150, updatedAt: 2 })).budget;
    out.stamp = mergeState(L, R).updatedAt;
    const a = mergeState(clean({ updatedAt: 2, ate: { '2026-10-08': ['a'] } }), clean({ updatedAt: 1, ate: { '2026-10-08': ['b', 'a'], '2026-10-09': ['c'] } })).ate;
    out.ate = JSON.stringify(a);
    // myPrices keys must be real food keys
    const k = window.__mbpTest.foodKey(0);
    const m = mergeState(clean({ updatedAt: 2, myPrices: { [k]: { p: 50, d: '2026-10-01' } } }), clean({ updatedAt: 1, myPrices: { [k]: { p: 60, d: '2026-10-05' } } })).myPrices[k].p;
    out.price = m;
    const tie = mergeState(clean({ updatedAt: 2, myPrices: { [k]: { p: 50, d: '2026-10-05' } } }), clean({ updatedAt: 1, myPrices: { [k]: { p: 60, d: '2026-10-05' } } })).myPrices[k].p;
    out.tie = tie;
    const ate = {}; const now = new Date();
    for (let i = 0; i < 30; i++) { const d = new Date(now); d.setDate(now.getDate() - i);
      ate[d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')] = ['x']; }
    const t = trimForUpload(clean({ ate, name: 'Asha', guest: true, step: 4, budget: 220 }));
    out.days = Object.keys(t.ate).length; out.trimName = t.name; out.trimGuest = t.guest; out.trimStep = t.step; out.trimBudget = t.budget;
    out.inputUntouched = Object.keys(ate).length;
    const hostile = JSON.parse('{"__proto__":{"polluted":1},"budget":"<img src=x onerror=alert(1)>","updatedAt":9}');
    const h = mergeState(clean({ budget: 200, updatedAt: 1 }), clean(hostile));
    out.hBudget = h.budget; out.polluted = ({}).polluted;
    return out;
  });
  ok(r.cleanKeepsStamp === 1234, 'clean keeps updatedAt');
  ok(r.cleanBadStamp === 0, 'clean drops bad updatedAt');
  ok(r.localNewer === 300, 'newer local wins');
  ok(r.remoteNewer === 150, 'newer remote wins');
  ok(r.stamp === 2, 'result stamp is max');
  ok(r.ate === JSON.stringify({ '2026-10-08': ['a', 'b'], '2026-10-09': ['c'] }), 'ate union per day ' + r.ate);
  ok(r.price === 60, 'later-dated price wins');
  ok(r.tie === 50, 'tie goes to base');
  ok(r.days === 14, 'trim keeps 14 days (got ' + r.days + ')');
  ok(r.trimName === null && r.trimGuest === false && r.trimStep === -1 && r.trimBudget === 220, 'trim clears name/guest/step only');
  ok(r.inputUntouched === 30, 'trim does not mutate input');
  ok(r.hBudget === 200 && r.polluted === undefined, 'hostile remote stays safe');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  await b.close(); done();
})();
