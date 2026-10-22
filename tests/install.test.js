// "Install app": hidden until the browser offers installing; on iPhone it shows the Add to Home Screen steps
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    { const p = await newDevice(b, makeStore()); await p.goto(APP); await wait(300);
      ok(await p.$eval('#installBtn', e => e.hidden), 'desktop/Android: hidden until the browser offers install');
      const r = await p.evaluate(async () => { let prompted = false; const e = new Event('beforeinstallprompt', { cancelable: true });
        e.prompt = () => { prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e);
        const shown = !document.getElementById('installBtn').hidden; document.getElementById('installBtn').click(); await new Promise(r => setTimeout(r, 100));
        return { shown, prompted, cancelled: e.defaultPrevented, hiddenAfter: document.getElementById('installBtn').hidden }; });
      ok(r.shown && r.cancelled, 'shown when the browser offers install (its own mini-bar is held back)');
      ok(r.prompted && r.hiddenAfter, 'tapping it opens the install prompt, then it hides');
      ok(await p.evaluate(() => !!document.querySelector('link[rel=manifest]')), 'manifest linked');
      ok(p.errors.length === 0, 'no errors ' + p.errors.join('|'));
      await p.context().close(); }
    { const p = await newDevice(b, makeStore());
      await p.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }));
      await p.goto(APP); await wait(300);
      ok(!(await p.$eval('#installBtn', e => e.hidden)), 'iPhone: install button shown');
      await p.click('#installBtn'); await wait(100);
      ok(/Add to Home Screen/.test(await p.$eval('#installTip', e => e.hidden ? '' : e.innerText)), 'iPhone: tapping it shows the Share, Add to Home Screen steps');
      await p.click('#installBtn'); await wait(100);
      ok(await p.$eval('#installTip', e => e.hidden), 'tapping again hides the steps');
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'header fits on a phone');
      ok(p.errors.length === 0, 'iPhone: no errors ' + p.errors.join('|'));
      await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
