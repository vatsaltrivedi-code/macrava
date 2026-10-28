// "Share my plan": a story-sized picture of today's plan, shared through the phone's share sheet or saved as a file
const fs = require('fs');
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const PLAN = { diet: 'veg', kitchen: false, place: 'hostel', meals: 2, step: 4, budget: 200, guest: true };
const seed = (p) => p.addInitScript((st) => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('mbp', JSON.stringify(st)); } }, PLAN);
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    // No share sheet (desktop): the picture downloads
    { const store = makeStore(); const p = await newDevice(b, store); await seed(p);
      await p.goto(APP); await wait(300); await p.click('#guest'); await wait(800);
      ok(await p.isVisible('#sharePlan'), 'plan shows a Share my plan button');
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#sharePlan')]);
      const buf = fs.readFileSync(await dl.path());
      ok(dl.suggestedFilename() === 'my-macrava-plan.png' && buf.slice(1, 4).toString() === 'PNG', 'downloads a PNG called my-macrava-plan.png');
      ok(pngSize(buf).join('x') === '1080x1920', 'picture is story size 1080x1920 (got ' + pngSize(buf).join('x') + ')');
      await wait(200);
      ok(/Saved the picture/.test(await p.textContent('body')), 'tells you the picture was saved');
      ok(store.usage.some(u => u.event === 'share'), 'share is counted');
      ok(!(await p.isDisabled('#sharePlan')), 'button works again afterwards');
      ok(p.errors.length === 0, 'no page errors (' + p.errors.join('; ') + ')');
      await p.context().close(); }
    // Phone with a share sheet: shares the picture file plus a short message and the link
    { const store = makeStore(); const p = await newDevice(b, store); await seed(p);
      await p.addInitScript(() => { window.__shared = null; navigator.canShare = (d) => !!(d && d.files); navigator.share = async (d) => { window.__shared = { files: d.files.map(f => [f.name, f.type, f.size]), text: d.text, url: d.url }; }; });
      await p.goto(APP); await wait(300); await p.click('#guest'); await wait(800);
      await p.click('#sharePlan'); await wait(800);
      const s = await p.evaluate(() => window.__shared);
      ok(s && s.files.length === 1 && s.files[0][0] === 'my-macrava-plan.png' && s.files[0][1] === 'image/png' && s.files[0][2] > 20000, 'opens the share sheet with the picture (' + JSON.stringify(s && s.files) + ')');
      ok(s && /My protein plan: \d+ g a day for ₹\d+/.test(s.text) && s.url === 'https://macrava.com', 'share text has protein, cost and the link (' + (s && s.text) + ')');
      // The message matches the plan on screen
      const shownP = await p.$eval('.ring .mid b', e => parseInt(e.textContent));
      ok(s && s.text.includes(shownP + ' g'), 'shared protein matches the plan (' + shownP + ')');
      await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
