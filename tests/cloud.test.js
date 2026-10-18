// Task 2: cloud adapter. Real makeCloud against intercepted Supabase HTTP, plus fake + no-config behaviour.
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const A = '11111111-1111-1111-1111-111111111111';
(async () => {
  const b = await chromium.launch();
  try {
    // 1. Real adapter, fake Supabase server
    build({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'pk_test' });
    const ctx = await b.newContext(); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.route('**fonts.g*/**', r => r.abort());
    const seen = []; let row = null;
    await p.route('https://x.supabase.co/**', async (r) => {
      const req = r.request(); const u = new URL(req.url()); seen.push(req.method() + ' ' + u.pathname + u.search);
      const auth = req.headers()['authorization'] || '';
      if (u.pathname === '/rest/v1/profiles' && req.method() === 'GET') {
        ok(auth === 'Bearer tok', 'GET sends the user token');
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row ? [row] : []) });
      }
      if (u.pathname === '/rest/v1/profiles' && req.method() === 'POST') {
        row = JSON.parse(req.postData()); row.updated_at = '2026-10-09T10:00:00Z';
        return r.fulfill({ status: 201, contentType: 'application/json', body: '' });
      }
      return r.fulfill({ status: 404, body: '{}' });
    });
    await p.addInitScript((uid) => {
      window.__mbpTestHook = true;
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('sb-x-auth-token', JSON.stringify({ access_token: 'tok', refresh_token: 'r', expires_at: exp, expires_in: 3600, token_type: 'bearer',
        user: { id: uid, email: 'a@b.co', aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: 'Asha K' }, app_metadata: {} } }));
    }, A);
    await p.goto(APP); await wait(800);
    ok(row && row.id === A, 'app uploads to an empty account on sign-in');
    row = null;
    const res = await p.evaluate(async () => {
      const c = window.__mbpTest.cloud;
      const s = await c.session(); const first = await c.load();
      await c.save({ name: 'Asha', city: 'Pune', area: '', state: { budget: 250 } });
      const second = await c.load();
      return { enabled: c.enabled, s, first, second };
    });
    ok(res.enabled === true, 'enabled with config');
    ok(res.s && res.s.id === A && res.s.name === 'Asha K' && res.s.email === 'a@b.co', 'session maps user id, name, email');
    ok(res.first === null, 'load with no row returns null');
    ok(res.second && res.second.state.budget === 250 && res.second.city === 'Pune', 'save then load round-trips');
    ok(row && row.id === A, 'upsert sends own id');
    ok(seen.some(s => /on_conflict=id|POST \/rest\/v1\/profiles/.test(s)), 'save is an upsert POST');
    ok(seen.some(s => /select=name%2Ccity%2Carea%2Cstate%2Cupdated_at|select=name,city,area,state,updated_at/.test(s) && /id=eq\./.test(s)), 'load selects own row columns');
    await p.unroute('https://x.supabase.co/**');
    await p.route('https://x.supabase.co/rest/**', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }));
    const threw = await p.evaluate(async () => { try { await window.__mbpTest.cloud.load(); return false; } catch (e) { return true; } });
    ok(threw, 'load throws on server error');
    ok(errs.length === 0, 'no page errors (real) ' + errs.join('|'));
    await ctx.close();

    // 2. Fake adapter
    build(null);
    const store = makeStore();
    const d = await newDevice(b, store, { session: { id: A, email: 'a@b.co', name: 'Asha' } });
    await d.goto(APP); await wait(300);
    const f = await d.evaluate(async () => { const c = window.__mbpTest.cloud; await c.save({ name: 'A', city: 'Pune', area: '', state: { budget: 300 } }); return (await c.load()).state.budget; });
    ok(f === 300, 'fake: save then load');
    store.offline = true;
    const rej = await d.evaluate(async () => { try { await window.__mbpTest.cloud.save({ state: {} }); return false; } catch (e) { return true; } });
    ok(rej, 'fake: save rejects when offline');

    // 3. No config, no mock
    const c3 = await b.newContext(); const p3 = await c3.newPage(); const e3 = []; const reqs = [];
    p3.on('pageerror', e => e3.push(e.message)); p3.on('request', r => { if (!r.url().startsWith('file:')) reqs.push(r.url()); });
    await p3.route('**fonts.g*/**', r => r.abort());
    await p3.addInitScript(() => { window.__mbpTestHook = true; });
    await p3.goto(APP); await wait(300);
    ok(await p3.evaluate(() => window.__mbpTest.cloud.enabled === false), 'no config: cloud disabled');
    ok(e3.length === 0 && !reqs.some(u => /supabase/.test(u)), 'no config: no errors, no supabase requests');
  } finally { build(null); await b.close(); }
  done();
})();
