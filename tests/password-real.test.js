// Email + password against the REAL supabase-js (HTTP routed): log in, wrong password, sign-up, existing email
const { chromium } = require('playwright');
const { APP, build, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const A = '33333333-3333-3333-3333-333333333333';
const session = (email) => ({ access_token: 'tok-' + email, refresh_token: 'r', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer',
  user: { id: A, email, aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: { provider: 'email' }, email_confirmed_at: new Date().toISOString() } });
async function device(b, hasProfile) {
  const ctx = await b.newContext({ viewport: { width: 360, height: 780 } }); const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message)); p.reqs = [];
  await p.route('**fonts.g*/**', r => r.abort());
  await p.route('https://x.supabase.co/**', async (r) => {
    const u = new URL(r.request().url()); const body = r.request().postDataJSON ? (() => { try { return r.request().postDataJSON(); } catch (e) { return null; } })() : null;
    p.reqs.push(u.pathname + u.search);
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
      if (body && body.email === 'a@b.co' && body.password === 'correct horse') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session(body.email)) });
      return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) });
    }
    if (u.pathname === '/auth/v1/signup') {
      if (body && body.email === 'a@b.co') return r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 422, error_code: 'user_already_exists', msg: 'User already registered' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session(body.email)) });
    }
    if (u.pathname === '/rest/v1/profiles' && r.request().method() === 'GET')
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hasProfile ? [{ name: 'Asha', city: 'Pune', area: '', state: { diet: 'egg', kitchen: true, place: 'home', city: 'Pune', budget: 210, updatedAt: 1 }, updated_at: '2026-10-09T00:00:00Z' }] : []) });
    if (u.pathname === '/rest/v1/profiles') return r.fulfill({ status: 201, body: '' });
    return r.fulfill({ status: 404, body: '{}' });
  });
  return p;
}
const text = (p) => p.evaluate(() => document.body.innerText);
(async () => {
  build({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'pk_test' });
  const b = await chromium.launch();
  try {
    { const p = await device(b, true); await p.goto(APP); await wait(1200);
      await p.click('#emailMode'); await p.fill('#aEmail', 'a@b.co'); await p.fill('#aPass', 'bad password'); await p.click('#pwGo'); await wait(1200);
      ok(/Wrong email or password/.test(await p.$eval('#aErr', e => e.innerText)), 'real: wrong password message');
      await p.fill('#aPass', 'correct horse'); await p.click('#pwGo'); await wait(2500);
      ok(!!(await p.$('#tBudget')) && /Asha/.test(await text(p)), 'real: login opens the account plan');
      ok(await p.evaluate(() => Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k))), 'real: session stored');
      ok(p.reqs.some(x => x === '/auth/v1/token?grant_type=password'), 'real: password grant used');
      ok(p.errors.length === 0, 'real login: no errors ' + p.errors.join('|'));
      await p.context().close(); }
    { const p = await device(b, false); await p.goto(APP); await wait(1200);
      await p.click('#emailMode'); await p.click('#pwSwitch'); await p.fill('#aEmail', 'a@b.co'); await p.fill('#aPass', 'whatever123'); await p.click('#pwGo'); await wait(1200);
      ok(/already an account/.test(await p.$eval('#aErr', e => e.innerText)), 'real: existing email message');
      await p.fill('#aEmail', 'fresh@b.co'); await p.click('#pwGo'); await wait(2500);
      ok(!!(await p.$('#aName')) && !!(await p.$('#aCity')), 'real: sign-up goes to Finish setup');
      ok(p.errors.length === 0, 'real signup: no errors ' + p.errors.join('|'));
      await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
