// Task 6: logout signs out of the account and clears this device
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const A = { id: '11111111-1111-1111-1111-111111111111', email: 'a@b.co', name: 'Asha' };
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    const store = makeStore();
    const p = await newDevice(b, store, { session: A });
    await p.addInitScript(() => { if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
      localStorage.setItem('mbp', JSON.stringify({ diet: 'egg', kitchen: true, place: 'home', step: 4, city: 'Pune', budget: 240 }));
      localStorage.setItem('mbp_owner', '11111111-1111-1111-1111-111111111111'); localStorage.setItem('mbp_pending', '1'); });
    await p.goto(APP); await wait(1500);
    ok(store.rows.has(A.id), 'signed in and synced before logout');
    await p.$eval('#tBudget', e => { e.value = 300; e.dispatchEvent(new Event('input')); }); await wait(400);  // leaves a sync scheduled
    await p.click('#logout'); await wait(500);
    const st = await p.evaluate(() => ({ calls: window.__fakeCalls, mbp: localStorage.getItem('mbp'), owner: localStorage.getItem('mbp_owner'),
      pending: localStorage.getItem('mbp_pending'), welcome: !!document.querySelector('#guest') }));
    ok(st.calls.includes('signOut'), 'cloud.signOut called');
    ok(st.mbp === null && st.owner === null && st.pending === null, 'mbp, mbp_owner, mbp_pending removed');
    ok(st.welcome, 'welcome screen shown');
    ok(store.rows.has(A.id), 'account row kept');
    const n = store.calls.length; await wait(3000);
    ok(store.calls.length === n, 'no syncing after logout');
    await p.reload(); await wait(800);
    ok(await p.evaluate(() => !!document.querySelector('#guest') && !document.querySelector('#tBudget')), 'reload stays logged out');
    ok(p.errors.length === 0, 'no errors ' + p.errors.join('|'));
    // Logout while an upload is mid-way: nothing may be written back to this device
    { const store2 = makeStore(); store2.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: { diet: 'egg', kitchen: true, place: 'home', city: 'Pune', budget: 250, updatedAt: 1 } });
      const q = await newDevice(b, store2, { session: A });
      await q.addInitScript(() => { if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
        localStorage.setItem('mbp', JSON.stringify({ diet: 'egg', kitchen: true, place: 'home', step: 4, city: 'Pune', budget: 240, updatedAt: 2 }));
        localStorage.setItem('mbp_owner', '11111111-1111-1111-1111-111111111111'); });
      await q.goto(APP); await wait(1500);
      store2.delay = 1500;
      await q.$eval('#tBudget', e => { e.value = 300; e.dispatchEvent(new Event('input')); }); await wait(2500);  // upload starts (load in flight)
      await q.click('#logout'); await wait(4000);
      const left = await q.evaluate(() => [localStorage.getItem('mbp'), localStorage.getItem('mbp_owner'), localStorage.getItem('mbp_pending')]);
      ok(left[0] === null && left[1] === null && left[2] === null, 'logout during upload: device stays clear ' + JSON.stringify(left).slice(0, 80));
      ok(q.errors.length === 0, 'logout during upload: no errors ' + q.errors.join('|')); }
    // Logout while the plan is still loading from the account at open: the plan must not come back
    { const store3 = makeStore(); store3.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: { diet: 'egg', kitchen: true, place: 'home', city: 'Pune', budget: 250, updatedAt: 9 } });
      store3.delay = 2000;
      const r = await newDevice(b, store3, { session: A });
      await r.addInitScript(() => { if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
        localStorage.setItem('mbp', JSON.stringify({ diet: 'egg', kitchen: true, place: 'home', step: 4, city: 'Pune', budget: 240, updatedAt: 2, name: 'Asha' }));
        localStorage.setItem('mbp_owner', '11111111-1111-1111-1111-111111111111'); localStorage.setItem('mbp_owner_name', 'Asha'); });
      await r.goto(APP); await r.waitForSelector('#logout'); await wait(200);   // plan shown, account load still in flight
      await r.click('#logout'); await wait(3500);
      const left = await r.evaluate(() => [localStorage.getItem('mbp'), localStorage.getItem('mbp_owner'), !!document.querySelector('#guest')]);
      ok(left[0] === null && left[1] === null && left[2], 'logout during open-load: device stays clear and logged out ' + JSON.stringify(left).slice(0, 80));
      ok(r.errors.length === 0, 'logout during open-load: no errors ' + r.errors.join('|')); }
  } finally { await b.close(); }
  done();
})();
