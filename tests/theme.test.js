// Light / dark toggle in the header
const { chromium } = require('playwright');
const { APP, build, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT = 'rgb(250, 250, 248)', DARK = 'rgb(14, 14, 13)';
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    // Phone in light mode
    { const c = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: 'light' }); const p = await c.newPage(); const errs = [];
      p.on('pageerror', e => errs.push(e.message)); await p.route('**fonts.g*/**', r => r.abort());
      await p.goto(APP); await wait(300);
      ok(await bg(p) === LIGHT, 'follows a light phone at first');
      ok(await p.$eval('#themeBtn', e => e.getAttribute('aria-label')).catch(() => null) === 'Switch to dark mode', 'button offers dark mode');
      await p.click('#themeBtn'); await wait(250);
      ok(await bg(p) === DARK && await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'one tap: dark');
      ok(await p.$eval('#themeBtn', e => e.getAttribute('aria-label')) === 'Switch to light mode', 'button now offers light mode');
      await p.reload(); await wait(300);
      ok(await bg(p) === DARK, 'choice remembered after reload');
      await p.click('#guest'); await wait(300);
      ok(!!(await p.$('#themeBtn')), 'button also on the quiz screens');
      await p.click('#themeBtn'); await wait(250);
      ok(await bg(p) === LIGHT, 'tap again: light');
      ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 360, 'fits a 360px screen');
      ok(errs.length === 0, 'no errors ' + errs.join('|')); await c.close(); }
    // Phone in dark mode
    { const c = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: 'dark' }); const p = await c.newPage();
      await p.route('**fonts.g*/**', r => r.abort()); await p.goto(APP); await wait(300);
      ok(await bg(p) === DARK && await p.$eval('#themeBtn', e => e.getAttribute('aria-label')).catch(() => null) === 'Switch to light mode', 'follows a dark phone, offers light');
      await p.click('#themeBtn'); await wait(250);
      ok(await bg(p) === LIGHT, 'dark phone, one tap: light');
      await c.close(); }
  } finally { await b.close(); }
  done();
})();
