// Live updates: an open app notices a new version and refreshes itself without losing your place
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const PLAN = { diet: 'veg', kitchen: false, place: 'hostel', meals: 2, step: 4, budget: 200, guest: true };
// A fake server: /version.json answers sessionStorage "ver"; the page thinks it is build "build"
async function device(b, idleMs) {
  const p = await newDevice(b, makeStore());
  await p.addInitScript(([st, idle]) => {
    if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('mbp', JSON.stringify(st)); }
    window.__mbpBuild = sessionStorage.getItem('build') || 'v1'; window.__mbpCheckMs = 250; window.__mbpIdleMs = idle;
    window.__loads = (+sessionStorage.getItem('loads') || 0) + 1; sessionStorage.setItem('loads', window.__loads);
    const f = window.fetch.bind(window);
    window.fetch = (u, o) => String(u).includes('version.json') ? Promise.resolve(new Response(JSON.stringify({ v: sessionStorage.getItem('ver') || 'v1' }))) : f(u, o);
  }, [PLAN, idleMs]);
  await p.goto(APP); await wait(300); await p.click('#guest'); await wait(800);
  return p;
}
const deploy = (p) => p.evaluate(() => { sessionStorage.setItem('ver', 'v2'); sessionStorage.setItem('build', 'v2'); });
const loads = (p) => p.evaluate(() => window.__loads);
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    // In use (not idle): a bar offers the update; Refresh keeps you on your plan and tab
    { const p = await device(b, 60000);
      await p.click('[data-tab=out]'); await wait(300);
      await wait(700);
      ok(!(await p.$('#updateBar')) && await loads(p) === 1, 'same version: no bar, no refresh');
      await deploy(p); await wait(800);
      ok(await p.isVisible('#updateBar') && await loads(p) === 1, 'new version while in use: shows the update bar, does not refresh by itself');
      await p.click('#updateBar button'); await wait(1500);
      ok(await loads(p) === 2, 'Refresh reloads the app');
      ok(await p.isVisible('#tBudget') && !(await p.$('#guest')), 'after refreshing you are still on your plan, not the welcome screen');
      ok(await p.getAttribute('[data-tab=out]', 'aria-selected') === 'true', 'and on the same tab (Order in)');
      await wait(800);
      ok(!(await p.$('#updateBar')) && await loads(p) === 2, 'now up to date: no bar, no more refreshes');
      ok(p.errors.length === 0, 'no page errors (' + p.errors.join('; ') + ')');
      await p.context().close(); }
    // Idle: refreshes by itself and keeps your place
    { const p = await device(b, 200);
      await deploy(p); await wait(1500);
      ok(await loads(p) === 2 && await p.isVisible('#tBudget'), 'idle: refreshes by itself and stays on the plan');
      await p.context().close(); }
    // Typing: never refreshes under you
    { const p = await device(b, 200);
      await p.click('#locChange'); await p.click('#lArea'); await p.keyboard.type('Knowledge Park');
      await deploy(p); await wait(1200);
      ok(await loads(p) === 1 && await p.inputValue('#lArea') === 'Knowledge Park', 'while typing: no refresh, text kept');
      ok(await p.isVisible('#updateBar'), 'while typing: the update bar is shown instead');
      await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
