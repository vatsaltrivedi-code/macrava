// Final-review fixes against the REAL supabase-js: expired token offline at open (F4) and logout offline (F6)
const { chromium } = require('playwright');
const { APP, build, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const A = '11111111-1111-1111-1111-111111111111';
const KEY = 'sb-x-auth-token';
async function device(b, { expired }) {
  const ctx = await b.newContext({ viewport: { width: 360, height: 780 } }); const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('**fonts.g*/**', r => r.abort());
  p.offline = false;
  await p.route('https://x.supabase.co/**', async (r) => {
    if (p.offline) return r.abort('internetdisconnected');
    const u = new URL(r.request().url());
    if (u.pathname === '/rest/v1/profiles' && r.request().method() === 'GET')
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'Asha', city: 'Pune', area: '', state: { diet: 'egg', kitchen: true, place: 'home', city: 'Pune', budget: 200, updatedAt: 1 }, updated_at: '2026-10-09T00:00:00Z' }]) });
    if (u.pathname === '/rest/v1/profiles') return r.fulfill({ status: 201, body: '' });
    if (u.pathname === '/auth/v1/logout') return r.fulfill({ status: 204, body: '' });
    if (u.pathname === '/rest/v1/rpc/delete_my_account') { p.rpcCalls = (p.rpcCalls || []).concat([r.request().method() + ' ' + (r.request().headers()['authorization'] || '')]);
      return p.rpcFail ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }) : r.fulfill({ status: 204, body: '' }); }
    return r.fulfill({ status: 404, body: '{}' });
  });
  await p.addInitScript(([uid, expired, key]) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    const exp = Math.floor(Date.now() / 1000) + (expired ? -600 : 3600);
    localStorage.setItem(key, JSON.stringify({ access_token: 'tok', refresh_token: 'r', expires_at: exp, expires_in: 3600, token_type: 'bearer',
      user: { id: uid, email: 'a@b.co', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} } }));
    localStorage.setItem('mbp', JSON.stringify({ diet: 'egg', kitchen: true, place: 'home', step: 4, city: 'Pune', budget: 230, updatedAt: 1 }));
    localStorage.setItem('mbp_owner', uid); localStorage.setItem('mbp_owner_name', 'Asha');
  }, [A, expired, KEY]);
  return p;
}
(async () => {
  build({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'pk_test' });
  const b = await chromium.launch();
  try {
    // F4. Expired token + offline at open -> plan from device + note, not welcome
    { const p = await device(b, { expired: true }); p.offline = true;
      await p.goto(APP); await wait(4500);   // session check gives up waiting for the network after 3 s
      const t = await p.evaluate(() => document.body.innerText);
      ok(!!(await p.$('#tBudget')) && !(await p.$('#guest')), 'F4: offline + expired token opens the plan');
      ok(/Couldn't reach your account\. Using this phone's copy\./.test(t), 'F4: reach note shown');
      ok(p.errors.length === 0, 'F4: no errors ' + p.errors.join('|'));
      await p.context().close(); }

    // F6. Logout while offline with an expired token removes the Supabase session from the device
    { const p = await device(b, { expired: false }); await p.goto(APP); await wait(2000);
      ok(!!(await p.$('#logout')), 'F6: signed in');
      await p.evaluate((key) => { const s = JSON.parse(localStorage.getItem(key)); s.expires_at = Math.floor(Date.now() / 1000) - 600; localStorage.setItem(key, JSON.stringify(s)); }, KEY);
      p.offline = true;
      await p.click('#logout'); await wait(1500);
      const left = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sb-') || k.startsWith('mbp') && !['mbp_device','mbp_seen','mbp_pro','mbp_loggedout'].includes(k)));
      ok(left.length === 0, 'F6: no session or plan keys left ' + JSON.stringify(left));
      p.offline = false; await p.reload(); await p.waitForSelector('#guest, #tBudget', { timeout: 8000 }).catch(() => {}); await wait(300);
      ok(!!(await p.$('#guest')) && !(await p.$('#tBudget')), 'F6: reload stays logged out ' + JSON.stringify(await p.evaluate(() => [Object.keys(localStorage), document.body.innerText.slice(0,120)])));
      await p.context().close(); }
    // D-real. Delete my account calls the database function with the user's token, then clears the device
    { const p = await device(b, { expired: false }); await p.goto(APP); await wait(2000);
      await p.click('#deleteAcct'); await wait(200); await p.click('#confirmDelete'); await wait(2000);
      ok((p.rpcCalls || []).length === 1 && /^POST Bearer tok$/.test(p.rpcCalls[0]), 'D-real: POST rpc/delete_my_account with user token ' + JSON.stringify(p.rpcCalls));
      const left = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sb-') || k.startsWith('mbp') && !['mbp_device','mbp_seen','mbp_pro','mbp_loggedout'].includes(k)));
      ok(left.length === 0 && !!(await p.$('#guest')), 'D-real: device cleared, welcome shown ' + JSON.stringify(left));
      await p.context().close(); }
    { const p = await device(b, { expired: false }); p.rpcFail = true; await p.goto(APP); await wait(2000);
      await p.click('#deleteAcct'); await wait(200); await p.click('#confirmDelete'); await wait(2000);
      ok(/Couldn't delete your account/.test(await p.evaluate(() => document.body.innerText)) && await p.evaluate(() => !!localStorage.getItem('sb-x-auth-token')), 'D-real: server error keeps the account signed in and says so');
      await p.context().close(); }
  } finally { build(null); await b.close(); }
  done();
})();
