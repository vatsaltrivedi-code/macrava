// Daily streak and progress on Today: the log, the streak, the week dots, the goal message and the home-screen nudge
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const PLAN = (log) => ({ diet: 'veg', kitchen: false, place: 'hostel', meals: 2, step: 4, budget: 200, guest: true, log });
async function open(b, log) {
  const p = await newDevice(b, makeStore());
  await p.addInitScript((st) => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('mbp', JSON.stringify(st)); } }, PLAN(log));
  await p.goto(APP); await wait(300); await p.click('#guest'); await wait(800);
  return p;
}
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('mbp')).log || {});
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    // New user: no streak, a nudge to start, 7 empty dots
    { const p = await open(b, {});
      ok(/No streak yet/.test(await p.textContent('.eaten')) && /start your streak/.test(await p.textContent('.e-msg')), 'new user: no streak yet, told how to start');
      ok((await p.$$('.e-day')).length === 7, 'shows the last 7 days');
      await p.click('.tick-btn'); await wait(300);
      const lg = await saved(p);
      ok(lg[day(0)] && lg[day(0)][0] > 0 && lg[day(0)][1] > 0, 'ticking saves today to the log (' + JSON.stringify(lg) + ')');
      ok(/1-day streak/.test(await p.textContent('.e-streak')), 'first tick starts a 1-day streak');
      ok(/g<\/b> to go|to go/.test(await p.innerHTML('.e-msg')), 'shows how much protein is left');
      await p.click('.tick-btn[aria-pressed="true"]'); await wait(300);
      ok(!(await saved(p))[day(0)], 'unticking everything removes today from the log');
      ok(p.errors.length === 0, 'no page errors (' + p.errors.join('; ') + ')');
      await p.context().close(); }
    // Returning user: yesterday and the day before logged, nothing yet today: streak still alive
    { const p = await open(b, { [day(1)]: [140, 130], [day(2)]: [60, 130], [day(4)]: [100, 130] });
      ok(/2-day streak/.test(await p.textContent('.e-streak')), 'streak counts back from yesterday when today is empty');
      ok(/keep your <b>2-day streak<\/b>/.test(await p.innerHTML('.e-msg')), 'reminds you to keep the streak');
      ok((await p.$$('.e-day.hit')).length === 1, 'a day that hit the goal is filled in');
      await p.click('.tick-btn'); await wait(300);
      ok(/3-day streak/.test(await p.textContent('.e-streak')), 'ticking today extends the streak to 3');
      await p.context().close(); }
    // Hitting the goal: tick everything
    { const p = await open(b, {});
      for (let i = 0; i < 30; i++) { const t = await p.$('.tick-btn[aria-pressed="false"]'); if (!t) break; await t.click(); await wait(150); }
      ok(await p.$('.eaten.done') && /Goal hit/.test(await p.textContent('.e-msg')), 'eating the whole plan shows Goal hit');
      ok((await p.$$('.e-day.hit')).length === 1, "today's dot is filled");
      await p.context().close(); }
    // Bad saved data is ignored safely
    { const p = await open(b, { 'not-a-date': [1, 2], [day(1)]: ['x', 3], [day(2)]: [50] });
      ok(/No streak yet/.test(await p.textContent('.e-streak')) && p.errors.length === 0, 'junk log entries are dropped');
      await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
