// Task 4: login screens
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const A = { id: '11111111-1111-1111-1111-111111111111', email: 'a@b.co', name: 'Asha K' };
const vis = (p, sel) => p.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight)).catch(() => false);
const text = (p) => p.evaluate(() => document.body.innerText);
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    // 1. No config: only guest
    { const c = await b.newContext(); const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.route('**fonts.g*/**', r => r.abort()); await p.goto(APP); await wait(300);
      ok(!(await vis(p, '#google')) && !(await vis(p, '#emailMode')), 'no config: no Google/email buttons');
      ok(await vis(p, '#guest') && /Try without an account/.test(await text(p)), 'no config: guest button with exact copy');
      ok(errs.length === 0, 'no config: no errors'); await c.close(); }

    // 2. Google sign-in, new account -> Finish setup -> diet step
    { const store = makeStore(); const p = await newDevice(b, store); await p.goto(APP); await wait(300);
      ok(await vis(p, '#guest') && /Make my free plan/.test(await text(p)) && await vis(p, '#google') && await vis(p, '#emailMode') && !/login link/i.test(await text(p)), 'welcome: free plan first, then Google and email sign-in');
      await p.click('#google'); ok((await p.evaluate(() => window.__fakeCalls)).includes('google'), 'Google button calls cloud.google');
      await store.signIn(p, A); await wait(400);
      ok(await p.$eval('#aName', e => e.value).catch(() => null) === 'Asha K', 'Finish setup pre-fills name');
      await p.click('#setup button[type=submit]'); await wait(100);
      ok(/city/i.test(await p.$eval('#aErr', e => e.innerText)), 'Finish setup requires city');
      await p.selectOption('#aCity', 'Pune'); await p.click('#setup button[type=submit]'); await wait(300);
      ok(await vis(p, '.opt[data-v=egg]'), 'after setup: diet step');
      ok(p.errors.length === 0, 'google flow: no errors ' + p.errors.join('|')); await p.context().close(); }

    // 3. Email + password: validation, create account, log in, wrong password, friendly errors
    { const store = makeStore(); const p = await newDevice(b, store); await p.goto(APP); await wait(300);
      await p.click('#emailMode'); await wait(100);
      ok(/Log in with email/.test(await text(p)) && await vis(p, '#aPass'), 'email screen has email + password');
      ok(await p.$eval('#aPass', e => e.type) === 'password' && await p.$eval('#aPass', e => e.autocomplete) === 'current-password', 'password hidden, current-password autocomplete');
      await p.click('#pwShow'); ok(await p.$eval('#aPass', e => e.type) === 'text', 'Show reveals password'); await p.click('#pwShow');
      await p.fill('#aEmail', 'nope'); await p.fill('#aPass', 'longenough'); await p.click('#pwGo'); await wait(100);
      ok(await p.$eval('#aErr', e => e.innerText) === 'Enter a valid email address, like name@gmail.com.', 'bad email message');
      // switch to create; the typed email is kept
      await p.fill('#aEmail', 'new@b.co'); await p.click('#pwSwitch'); await wait(100);
      ok(/Create an account/.test(await text(p)) && await p.$eval('#aEmail', e => e.value) === 'new@b.co', 'switch to Create keeps email');
      ok(await p.$eval('#aPass', e => e.autocomplete) === 'new-password', 'create uses new-password autocomplete');
      await p.fill('#aPass', 'short'); await p.click('#pwGo'); await wait(100);
      ok(/at least 8 characters/.test(await p.$eval('#aErr', e => e.innerText)), 'short password refused before sending');
      ok(!(await p.evaluate(() => window.__fakeCalls)).some(c => /^signup:/.test(c)), 'nothing sent for short password');
      await p.fill('#aPass', 'correct horse'); await p.click('#pwGo'); await wait(500);
      ok((await p.evaluate(() => window.__fakeCalls)).includes('signup:new@b.co'), 'sign-up sent');
      ok(await vis(p, '#aName') && await vis(p, '#aCity'), 'new email account goes to Finish setup');
      ok(p.errors.length === 0, 'sign-up: no errors ' + p.errors.join('|'));
      await p.context().close();
      // second device: wrong password, then right one
      const q = await newDevice(b, store); await q.goto(APP); await wait(300);
      await q.click('#emailMode'); await q.fill('#aEmail', 'NEW@b.co '); await q.fill('#aPass', 'wrong password'); await q.click('#pwGo'); await wait(300);
      ok(/Wrong email or password\. If you signed up with Google, use Continue with Google\./.test(await q.$eval('#aErr', e => e.innerText)), 'wrong password: friendly message');
      await q.fill('#aPass', 'correct horse'); await q.click('#pwGo'); await wait(500);
      ok((await q.evaluate(() => window.__fakeCalls)).includes('login:new@b.co'), 'login sent with trimmed lowercase email');
      ok(!(await vis(q, '#aPass')), 'logged in: left the email screen');
      ok(q.errors.length === 0, 'login: no errors ' + q.errors.join('|'));
      await q.context().close();
      // already registered, offline, confirm-email-on
      const r = await newDevice(b, store); await r.goto(APP); await wait(300);
      await r.click('#emailMode'); await r.click('#pwSwitch'); await r.fill('#aEmail', 'new@b.co'); await r.fill('#aPass', 'whatever123'); await r.click('#pwGo'); await wait(300);
      ok(/already an account with this email\. Log in instead\./.test(await r.$eval('#aErr', e => e.innerText)), 'existing email: log in instead');
      store.offline = true; await r.click('#pwGo'); await wait(300);
      ok(/Couldn't reach the server/.test(await r.$eval('#aErr', e => e.innerText)) && !(await r.$eval('#pwGo', e => e.disabled)), 'offline: message and button usable again');
      store.offline = false; store.needsConfirm = true; await r.fill('#aEmail', 'other@b.co'); await r.click('#pwGo'); await wait(300);
      ok(/Check your inbox to confirm your email/.test(await text(r)), 'confirmation needed: inbox message');
      store.needsConfirm = false; store.pwError = 'Request rate limit reached'; await r.click('#pwGo'); await wait(300);
      ok(/Too many tries/.test(await r.$eval('#aErr', e => e.innerText)), 'rate limit: friendly message');
      store.pwError = null;
      await r.click('#back'); await wait(100); ok(await vis(r, '#google') && await vis(r, '#emailMode'), 'Back returns to welcome');
      ok(r.errors.length === 0, 'errors path: no errors ' + r.errors.join('|'));
      await r.context().close(); }

    // 4. Errors in the address bar
    for (const [q, re, label] of [
      ['?error=invalid_request&error_description=invalid+flow+state%2C+no+valid+flow+state+found', /Open the link in the same browser you asked for it from\./, 'flow_state error'],
      ['?error_description=code+verifier+not+found', /Open the link in the same browser you asked for it from\./, 'code verifier error'],
      ['?code=abc123', /Open the link in the same browser you asked for it from\./, 'code with no session'],
      ['#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', /That link has expired or was already used\./, 'expired link'],
      ['?error=access_denied&error_description=user+cancelled', /Sign-in didn't finish\. Please try again\./, 'cancelled Google'],
    ]) { const store = makeStore(); const p = await newDevice(b, store); await p.goto(APP + q); await wait(400);
      ok(re.test(await text(p)), label + ': message');
      ok(await p.evaluate(() => location.search === '' && location.hash === ''), label + ': address bar cleared');
      ok(await vis(p, '#useEmail'), label + ': Continue with email offered'); await p.context().close(); }

    // 5. Old local account removed, plan kept
    { const store = makeStore(); const p = await newDevice(b, store); await p.goto(APP);
      await p.evaluate(() => { localStorage.setItem('mbp_user', JSON.stringify({ name: 'Old', email: 'o@x.co' }));
        localStorage.setItem('mbp', JSON.stringify({ diet: 'veg', kitchen: true, place: 'home', budget: 240, step: 4, city: 'Pune' })); });
      await p.reload(); await wait(300);
      const st = await p.evaluate(() => [localStorage.getItem('mbp_user'), JSON.parse(localStorage.getItem('mbp')).diet]);
      ok(st[0] === null && st[1] === 'veg', 'mbp_user removed, plan kept');
      await p.click('#guest'); await wait(600); ok(await vis(p, '#tBudget'), 'guest goes to kept plan'); await p.context().close(); }

    // 6. Returning signed-in user with name+city lands on plan
    { const store = makeStore(); const p = await newDevice(b, store, { session: A }); await p.goto(APP);
      await p.evaluate(() => localStorage.setItem('mbp', JSON.stringify({ diet: 'egg', kitchen: true, place: 'home', budget: 200, step: 4, city: 'Pune', name: 'Asha' })));
      await p.reload(); await wait(800);
      ok(await vis(p, '#tBudget') && /Asha K, this costs you/.test(await text(p)), 'signed-in returning user lands on plan with name');
      ok(p.errors.length === 0, 'returning: no errors ' + p.errors.join('|')); await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
