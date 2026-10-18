// The 6 small fixes + "Delete my account"
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
const vis = (p, sel) => p.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight)).catch(() => false);
const text = (p) => p.evaluate(() => document.body.innerText);
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    // D1. Delete my account: confirm screen, then account + device data gone
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const p = await newDevice(b, store, { session: A }); await seed(p, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      ok(await vis(p, '#deleteAcct'), 'D1: Delete my account link shown when signed in');
      await p.click('#deleteAcct'); await wait(200);
      ok(/This permanently deletes your account and your saved plan\. This can't be undone\./.test(await text(p)), 'D1: confirm screen explains');
      ok(store.rows.has(A.id), 'D1: nothing deleted before confirming');
      await p.click('#confirmDelete'); await wait(800);
      const st = await p.evaluate(() => ({ calls: window.__fakeCalls, keys: Object.keys(localStorage).filter(k => (k.startsWith('mbp') && !['mbp_device','mbp_seen','mbp_pro','mbp_loggedout'].includes(k)) || k === 'fake_session'), welcome: !!document.querySelector('#guest') }));
      ok(st.calls.includes('deleteAccount') && !store.rows.has(A.id), 'D1: account deleted');
      ok(st.keys.length === 0, 'D1: device cleared ' + JSON.stringify(st.keys));
      ok(st.welcome, 'D1: back to welcome');
      ok(p.errors.length === 0, 'D1: no errors ' + p.errors.join('|')); await p.context().close(); }

    // D2. Cancel keeps everything
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const p = await newDevice(b, store, { session: A }); await seed(p, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      await p.click('#deleteAcct'); await wait(200); await p.click('#cancelDelete'); await wait(500);
      ok(await vis(p, '#tBudget') && store.rows.has(A.id) && !(await p.evaluate(() => window.__fakeCalls)).includes('deleteAccount'), 'D2: cancel returns to plan, nothing deleted');
      await p.context().close(); }

    // D3. Offline: error shown, nothing removed locally
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const p = await newDevice(b, store, { session: A }); await seed(p, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      store.offline = true; await p.click('#deleteAcct'); await wait(200); await p.click('#confirmDelete'); await wait(800);
      ok(/Couldn't delete your account/.test(await text(p)), 'D3: offline error shown');
      ok(await p.evaluate(() => !!localStorage.getItem('mbp') && !!localStorage.getItem('fake_session')), 'D3: device data and sign-in kept');
      await p.context().close(); }

    // F10. Back button hidden on Finish setup and the two-plans choice while signed in
    { const store = makeStore(); const p = await newDevice(b, store); await p.goto(APP); await wait(300);
      await store.signIn(p, A); await wait(600);
      ok(await vis(p, '#setup') && !(await vis(p, '#back')), 'F10: no back button on Finish setup');
      await p.context().close(); }
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ budget: 330, step: -1, updatedAt: 5 }) });
      const p = await newDevice(b, store); await seed(p, PLAN({ budget: 260 })); await wait(300);
      await store.signIn(p, A); await wait(600);
      ok(await vis(p, '#keepPhone') && !(await vis(p, '#back')), 'F10: no back button on two-plans choice');
      await p.context().close(); }

    // F11. Cancelled Google sign-in leads with Google again
    { const store = makeStore(); const p = await newDevice(b, store); await p.goto(APP + '?error=access_denied&error_description=user+cancelled'); await wait(400);
      const first = await p.$eval('section .cta', e => e.textContent.trim()).catch(() => '');
      ok(first === 'Continue with Google' && !!(await p.$('section .cta img')), 'F11: primary button is Continue with Google with the G logo (got ' + first + ')');
      await p.click('section .cta'); await wait(200);
      ok((await p.evaluate(() => window.__fakeCalls)).includes('google'), 'F11: it starts Google sign-in');
      await p.context().close(); }
    { const store = makeStore(); const p = await newDevice(b, store); await p.goto(APP + '?error_description=Email+link+is+invalid+or+has+expired&error_code=otp_expired'); await wait(400);
      ok(await p.$eval('section .cta', e => e.textContent.trim()).catch(() => '') === 'Continue with email', 'F11: expired email link leads with Continue with email');
      await p.context().close(); }

    // F12. Change then app hidden/closed: uploads straight away (before the 2 s wait)
    { const store = makeStore(); store.rows.set(A.id, { name: 'Asha', city: 'Pune', area: '', state: PLAN({ step: -1, updatedAt: 1 }) });
      const p = await newDevice(b, store, { session: A }); await seed(p, PLAN({ updatedAt: 1 }), { mbp_owner: A.id }); await wait(1500);
      await p.$eval('#tBudget', e => { e.value = 290; e.dispatchEvent(new Event('input')); }); await wait(400);
      await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await wait(600);
      ok(store.rows.get(A.id).state.budget === 290, 'F12: uploaded on hide (got ' + store.rows.get(A.id).state.budget + ')');
      await p.context().close(); }

    // F13. Pizza-slice choice survives save/reload
    { const c = await b.newContext(); const p = await c.newPage(); await p.route('**fonts.g*/**', r => r.abort());
      await p.addInitScript(() => { window.__mbpTestHook = true; }); await p.goto(APP); await wait(200);
      const f = await p.evaluate(() => [window.__mbpTest.clean({ out: [{ key: 'k', price: 300, frac: 0.25 }] }).out[0].frac,
        window.__mbpTest.clean({ out: [{ key: 'k', frac: '<x>' }] }).out[0].frac, window.__mbpTest.clean({ out: [{ key: 'k', frac: 5 }] }).out[0].frac]);
      ok(f[0] === 0.25 && f[1] === undefined && f[2] === undefined, 'F13: frac kept when valid, dropped when not ' + JSON.stringify(f));
      await c.close(); }

    // F8. Slow sign-in: code in URL + verifier stored -> "Still signing you in…", then routes when the session arrives
    { const store = makeStore(); const p = await newDevice(b, store);
      await p.addInitScript(() => { if (!sessionStorage.getItem('v')) { sessionStorage.setItem('v', 1); localStorage.setItem('sb-x-auth-token-code-verifier', 'abc'); } });
      await p.goto(APP + '?code=abc123'); await wait(500);
      const t = await text(p);
      ok(/Still signing you in…/.test(t) && !/same browser/.test(t), 'F8: waiting message, not the wrong error');
      await store.signIn(p, A); await wait(600);
      ok(await vis(p, '#setup'), 'F8: continues once signed in');
      await p.context().close(); }
    // F8b. A sign-in that never finishes stops waiting after 15 s
    { const store = makeStore(); const p = await newDevice(b, store);
      await p.addInitScript(() => { if (!sessionStorage.getItem('v')) { sessionStorage.setItem('v', 1); localStorage.setItem('sb-x-auth-token-code-verifier', 'abc'); } });
      await p.goto(APP + '?code=abc123'); await wait(16000);
      const t = await text(p);
      ok(/Couldn't finish signing in\. Check your connection and try again\./.test(t) && await vis(p, '#googleRetry') && await vis(p, '#useEmail'), 'F8b: gives up with a clear message');
      await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
