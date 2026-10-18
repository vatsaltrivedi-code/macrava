// Final-review fixes: three-way sync, stale devices, tabs, clocks, owners, email-user offline
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const A = { id: '11111111-1111-1111-1111-111111111111', email: 'a@b.co', name: 'Asha' };
const PLAN = (o) => Object.assign({ diet: 'nonveg', kitchen: true, place: 'home', meals: 0, step: 4, city: 'Pune', budget: 200 }, o);
const seed = async (p, st, extra = {}) => {
  await p.addInitScript(([s, x]) => { if (sessionStorage.getItem('seededPlan')) return; sessionStorage.setItem('seededPlan', '1');
    if (s) localStorage.setItem('mbp', JSON.stringify(s)); for (const k in x) localStorage.setItem(k, x[k]); }, [st, extra]);
  await p.goto(APP);
};
const setBudget = (p, v) => p.$eval('#tBudget', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, v);
const budgetShown = (p) => p.$eval('#tBudget', e => +e.value).catch(() => null);
const row = (store) => store.rows.get(A.id);
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    // F1. Untick stays unticked after syncing
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const p = await newDevice(b, store, { session: A }); await seed(p, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      const sel = '.tick-btn[data-ate]:not([data-ate$=":mess"])';
      const key = await p.$eval(sel, e => e.dataset.ate);
      await p.click(`[data-ate="${key}"]`); await wait(2600);
      ok(Object.values(row(store).state.ate).flat().includes(key), 'F1: tick uploaded');
      await p.click(`[data-ate="${key}"]`); await wait(3000);
      ok(await p.$eval(`[data-ate="${key}"]`, e => e.getAttribute('aria-pressed')) === 'false', 'F1: untick stays on screen');
      ok(!Object.values(row(store).state.ate).flat().includes(key), 'F1: untick reaches account');
      await p.context().close(); }

    // F2. Stale open device must not overwrite another device's newer change
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const pA = await newDevice(b, store, { session: A }); await seed(pA, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      const pB = await newDevice(b, store, { session: A }); await pB.goto(APP); await wait(1500);
      await setBudget(pB, 310); await wait(2800);
      ok(row(store).state.budget === 310, 'F2: B uploaded 310');
      const key = await pA.$eval('.tick-btn[data-ate]:not([data-ate$=":mess"])', e => e.dataset.ate);
      await pA.click(`[data-ate="${key}"]`); await wait(3000);
      ok(row(store).state.budget === 310, 'F2: stale A ticking does not revert budget (got ' + row(store).state.budget + ')');
      ok(Object.values(row(store).state.ate).flat().includes(key), 'F2: A\'s tick still reaches account');
      ok(await budgetShown(pA) === 310, 'F2: A now shows 310');
      // returning to the tab pulls even with nothing pending
      await setBudget(pB, 330); await wait(2800);
      await pA.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(1500);
      ok(await budgetShown(pA) === 330, 'F2: A pulls on return to tab (got ' + await budgetShown(pA) + ')');
      await pA.context().close(); await pB.context().close(); }

    // F2b. Two tabs on one device
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const t1 = await newDevice(b, store, { session: A }); await seed(t1, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      const t2 = await t1.context().newPage(); t2.errors = []; t2.on('pageerror', e => t2.errors.push(e.message));
      await t2.goto(APP); await wait(1500);
      await setBudget(t1, 270); await wait(800);
      ok(await budgetShown(t2) === 270, 'F2b: other tab picks up the change (got ' + await budgetShown(t2) + ')');
      await t2.$eval('.tick-btn[data-ate]:not([data-ate$=":mess"])', e => e.click()); await wait(3200);
      ok(row(store).state.budget === 270, 'F2b: other tab does not revert it');
      await t1.context().close(); }

    // F3. A future timestamp in the account doesn't freeze edits
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, budget: 300, updatedAt: Date.now() + 86400000 }) });
      const p = await newDevice(b, store, { session: A }); await seed(p, PLAN({ budget: 300, updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      await setBudget(p, 250); await wait(2800);
      await setBudget(p, 240); await wait(2800);
      ok(await budgetShown(p) === 240 && row(store).state.budget === 240, 'F3: edits stick despite future stamp (screen ' + await budgetShown(p) + ', account ' + row(store).state.budget + ')');
      await p.context().close(); }

    // F5. Email user (no Google name), offline at open -> plan, not Finish setup
    { const store = makeStore(); const E = { id: A.id, email: 'a@b.co', name: '' };
      store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const p = await newDevice(b, store, { session: E }); await seed(p, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      store.offline = true; await p.reload(); await wait(1500);
      ok(await budgetShown(p) === 200 && !(await p.$('#setup')), 'F5: email user offline lands on plan');
      ok(/Asha, this costs you/.test(await p.evaluate(() => document.body.innerText)), 'F5: name remembered');
      await p.context().close(); }

    // F14. Device holding another account's plan: not uploaded to a new account
    { const store = makeStore();
      const p = await newDevice(b, store); await seed(p, PLAN({ budget: 410, updatedAt: 5 }), { mbp_owner: '99999999-9999-9999-9999-999999999999' }); await wait(500);
      await store.signIn(p, A); await wait(2500);
      const r = row(store);
      ok(!r || r.state.budget !== 410, 'F14: other account\'s plan not uploaded (got ' + (r && r.state.budget) + ')');
      ok(await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('mbp') || '{}'); return m.budget !== 410; }), 'F14: other account\'s plan cleared from device');
      ok(p.errors.length === 0, 'F14: no errors ' + p.errors.join('|'));
      await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
