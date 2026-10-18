// Test helpers: a fake account server shared by several "devices" (browser contexts).
const path = require('path'); const fs = require('fs'); const { execSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const APP = 'file://' + path.join(root, 'macro-budget-planner.html');

function build(cfg) {
  const f = path.join(root, 'config.json');
  if (cfg) fs.writeFileSync(f, JSON.stringify(cfg)); else if (fs.existsSync(f)) fs.unlinkSync(f);
  execSync('python3 build_local.py', { cwd: root, stdio: 'pipe' });
  if (cfg) fs.unlinkSync(f);
}

function makeStore() {
  return { rows: new Map(), offline: false, delay: 0, calls: [], accounts: new Map(), pro: new Map(), usage: [], food: [], pwError: null, needsConfirm: false,
    async signIn(page, user) { await page.evaluate((u) => window.__fakeSignIn(u), user); } };
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function newDevice(browser, store, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route('**fonts.g*/**', r => r.abort());
  await ctx.exposeFunction('__cloudCall', async (op, uid, arg) => {
    store.calls.push({ op, uid, arg });
    if (store.delay) await wait(store.delay);
    if (op === 'password') {
      if (store.offline) return { error: 'Failed to fetch' };
      if (store.pwError) return { error: store.pwError };
      if (store.needsConfirm) return { needsConfirm: true };
      const acc = store.accounts.get(arg.email);
      if (arg.create) {
        if (acc) return { error: 'User already registered' };
        const user = { id: '22222222-2222-2222-2222-' + String(store.accounts.size + 1).padStart(12, '0'), email: arg.email, name: '' };
        store.accounts.set(arg.email, { password: arg.password, user }); return { user };
      }
      if (!acc || acc.password !== arg.password) return { error: 'Invalid login credentials' };
      return { user: acc.user };
    }
    if (op === 'signOut') return null;
    if (op === 'food') { if (store.offline) throw new Error('Failed to fetch'); store.food.push(arg); return null; }
    if (op === 'usage') { if (store.offline) throw new Error('Failed to fetch'); store.usage.push(arg); return null; }
    if (op === 'proInterest') { if (store.offline) throw new Error('Failed to fetch'); store.pro.set(arg.device, arg); return null; }
    if (store.offline) throw new Error('Failed to fetch');
    if (op === 'load') return store.rows.has(uid) ? JSON.parse(JSON.stringify(store.rows.get(uid))) : null;
    if (op === 'deleteAccount') { store.rows.delete(uid); return null; }
    if (op === 'save') { store.rows.set(uid, Object.assign({}, arg, { updated_at: new Date().toISOString() })); return null; }
    throw new Error('unknown op ' + op);
  });
  await ctx.addInitScript(() => {
    const KEY = 'fake_session';
    const listeners = [];
    const me = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
    window.__fakeCalls = [];
    window.__fakeSignIn = (u) => { localStorage.setItem(KEY, JSON.stringify(u)); listeners.forEach(f => setTimeout(() => f(u), 0)); };
    // Like supabase-js: report the stored session to listeners once on start (INITIAL_SESSION)
    window.__cloudMock = {
      enabled: true,
      async session() { return me(); },
      onChange(fn) { listeners.push(fn); const u = me(); if (u) setTimeout(() => fn(u), 0); },
      async google() { window.__fakeCalls.push('google'); },
      async password(a) { window.__fakeCalls.push((a.create ? 'signup:' : 'login:') + a.email); const r = await window.__cloudCall('password', null, a); if (r && r.user) window.__fakeSignIn(r.user); return r; },
      async food(device, event, id, name) { return window.__cloudCall('food', null, { device, event, id, name }); },
      async usage(device, event) { return window.__cloudCall('usage', null, { device, event }); },
      async proInterest(device, answer, feature, price) { window.__fakeCalls.push('pro:' + answer + ':' + feature + ':' + price); return window.__cloudCall('proInterest', null, { device, answer, feature, price }); },
      async signOut() { window.__fakeCalls.push('signOut'); localStorage.removeItem(KEY); listeners.forEach(f => setTimeout(() => f(null), 0)); },
      async load() { const u = me(); if (!u) return null; return window.__cloudCall('load', u.id, null); },
      async deleteAccount() { const u = me(); if (!u) throw new Error('not signed in'); window.__fakeCalls.push('deleteAccount'); await window.__cloudCall('deleteAccount', u.id, null); localStorage.removeItem(KEY); },
      async save(row) { const u = me(); if (!u) throw new Error('not signed in'); return window.__cloudCall('save', u.id, row); },
    };
  });
  if (opts.session) await ctx.addInitScript((u) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('fake_session', JSON.stringify(u)); sessionStorage.setItem('seeded', '1'); } }, opts.session);
  return page;
}

function reporter() {
  let fail = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
  const done = () => { console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0); };
  return { ok, done };
}

module.exports = { APP, build, makeStore, newDevice, reporter, wait, root };
