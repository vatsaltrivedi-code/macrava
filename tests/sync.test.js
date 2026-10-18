// Task 5: device-first sync
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const A = { id: '11111111-1111-1111-1111-111111111111', email: 'a@b.co', name: 'Asha' };
const PLAN = (o) => Object.assign({ diet: 'nonveg', kitchen: true, place: 'home', meals: 0, step: 4, city: 'Pune', budget: 200 }, o);
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
// Seed storage before any app script runs (loading the app first would let its sync race the seed)
const seed = async (p, st, extra = {}) => {
  await p.addInitScript(([s, x]) => { if (sessionStorage.getItem('seededPlan')) return; sessionStorage.setItem('seededPlan', '1');
    localStorage.setItem('mbp', JSON.stringify(s)); for (const k in x) localStorage.setItem(k, x[k]); }, [st, extra]);
  await p.goto(APP);
};
const setBudget = (p, v) => p.$eval('#tBudget', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, v);
const budgetShown = (p) => p.$eval('#tBudget', e => +e.value).catch(() => null);
const body = (p) => p.evaluate(() => document.body.innerText);
const count = (s, sub) => s.split(sub).length - 1;
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    // 1. Guest plan, sign in to an empty account -> uploaded
    { const store = makeStore(); const p = await newDevice(b, store); await seed(p, PLAN({ budget: 260 })); await wait(300);
      await store.signIn(p, A); await wait(1500);
      const r = store.rows.get(A.id);
      ok(r && r.state.diet === 'nonveg' && r.state.budget === 260 && r.city === 'Pune' && r.name === 'Asha', 'guest plan uploaded to empty account');
      ok(r && r.state.name === null && r.state.step === -1, 'uploaded state has no name/step');
      await p.context().close(); }

    // 2. Guest plan + account plan, different owner -> choice
    for (const [btn, want] of [['#keepPhone', 260], ['#useAccount', 330]]) {
      const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ budget: 330, step: -1, updatedAt: 5 }) });
      const p = await newDevice(b, store); await seed(p, PLAN({ budget: 260 })); await wait(300);
      await store.signIn(p, A); await wait(600);
      const t = await body(p);
      ok(/Keep this phone's plan/.test(t) && /Use my account's plan/.test(t), 'choice shown (' + btn + ')');
      await p.click(btn); await wait(2000);
      ok(await budgetShown(p) === want, btn + ' -> budget ' + want + ' (got ' + await budgetShown(p) + ')');
      ok(store.rows.get(A.id).state.budget === want, btn + ' -> account saved ' + want);
      await p.context().close(); }

    // 3. Two devices: newer plan wins, ticks combined
    { const store = makeStore(); const d = today();
      store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ budget: 200, step: -1, updatedAt: 1, ate: { [d]: ['r1'] } }) });
      const pA = await newDevice(b, store, { session: A }); await seed(pA, PLAN({ budget: 250, updatedAt: 2, ate: { [d]: ['a1'] } }), { mbp_owner: A.id }); await wait(2500);
      const st = store.rows.get(A.id).state;
      ok(st.budget === 250 && st.ate[d] && st.ate[d].includes('a1') && st.ate[d].includes('r1'), 'device A: newer wins, ticks combined');
      const pB = await newDevice(b, store, { session: A }); await pB.goto(APP); await wait(1500);
      ok(await budgetShown(pB) === 250, 'device B opens with 250');
      await setBudget(pB, 310); await wait(2800);
      await pA.reload(); await wait(1500);
      ok(await budgetShown(pA) === 310, 'device A sees B\'s later change');
      ok(pA.errors.length === 0 && pB.errors.length === 0, 'two devices: no errors ' + pA.errors.concat(pB.errors).join('|'));
      await pA.context().close(); await pB.context().close(); }

    // 4. Offline change -> note; back online -> uploaded, note gone
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const p = await newDevice(b, store, { session: A }); await seed(p, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      store.offline = true; await setBudget(p, 280); await wait(2800);
      ok(/Saved on this phone · will sync/.test(await body(p)), 'offline: pending note');
      ok(await p.evaluate(() => localStorage.getItem('mbp_pending')) === '1', 'offline: pending flag');
      store.offline = false; await p.evaluate(() => window.dispatchEvent(new Event('online'))); await wait(1200);
      ok(store.rows.get(A.id).state.budget === 280, 'online: change uploaded');
      ok(!/Saved on this phone · will sync/.test(await body(p)) && await p.evaluate(() => localStorage.getItem('mbp_pending')) === null, 'online: note and flag cleared');
      await p.context().close(); }

    // 5. Hostile row
    { const store = makeStore(); store.rows.set(A.id, { name: '<img src=x onerror=window.__x=1>', city: 'Pune', area: '"><svg onload=window.__x=2>',
        state: { diet: 'nonveg', kitchen: true, place: 'home', budget: '<svg onload=window.__x=3>', updatedAt: 99999999999999, __proto__: null } });
      const p = await newDevice(b, store, { session: A }); await seed(p, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(2000);
      const r = await p.evaluate(() => ({ x: window.__x, n: document.querySelectorAll('img[src=x],svg[onload]').length, b: JSON.parse(localStorage.getItem('mbp')).budget }));
      ok(r.x === undefined && r.n === 0 && r.b === 200, 'hostile row: cleaned, nothing injected (budget ' + r.b + ')');
      ok(p.errors.length === 0, 'hostile row: no errors ' + p.errors.join('|')); await p.context().close(); }

    // 6. Change during an in-flight upload is not lost
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const p = await newDevice(b, store, { session: A }); await seed(p, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      store.delay = 1500; await setBudget(p, 250); await wait(2600);
      await setBudget(p, 260); await wait(11000);
      ok(store.rows.get(A.id).state.budget === 260, 'in-flight: final budget 260 (got ' + store.rows.get(A.id).state.budget + ')');
      await p.context().close(); }

    // 7. Signed in but offline at open
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const p = await newDevice(b, store, { session: A }); store.offline = true;
      await seed(p, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      const t = await body(p);
      ok(await budgetShown(p) === 200, 'offline at open: plan renders');
      ok(count(t, "Couldn't reach your account. Using this phone's copy.") === 1, 'offline at open: note shown once');
      await setBudget(p, 220); await wait(2600);
      ok(count(await body(p), "Couldn't reach your account.") <= 1, 'offline at open: note not repeated');
      store.offline = false; await p.evaluate(() => window.dispatchEvent(new Event('online'))); await wait(1200);
      ok(store.rows.get(A.id).state.budget === 220, 'offline at open: still signed in, syncs when back');
      ok(p.errors.length === 0, 'offline at open: no errors ' + p.errors.join('|')); await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
