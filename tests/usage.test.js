// Launch metrics: anonymous events, at most once a day per device, retried after a failed send
const { chromium } = require('playwright');
const { APP, build, makeStore, newDevice, reporter, wait } = require('./helpers');
const { ok, done } = reporter();
const PLAN = { diet: 'nonveg', kitchen: true, place: 'home', step: 4, city: 'Delhi NCR', budget: 200, guest: true };
const A = { id: '11111111-1111-1111-1111-111111111111', email: 'a@b.co', name: 'Asha' };
const evs = (store) => store.usage.map(u => u.event);
(async () => {
  build(null);
  const b = await chromium.launch();
  try {
    { const store = makeStore(); const p = await newDevice(b, store);
      await p.addInitScript((st) => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('mbp', JSON.stringify(st)); } }, PLAN);
      await p.goto(APP); await wait(300);
      ok(evs(store).join() === 'open', 'opening the site counts open (got ' + evs(store) + ')');
      await p.click('#guest'); await wait(700);
      ok(evs(store).includes('plan'), 'plan counted when the plan shows');
      await p.click('.tick-btn'); await wait(200); await p.click('.tick-btn'); await wait(200); await p.click('.tick-btn'); await wait(200);
      ok(evs(store).filter(e => e === 'tick').length === 1, 'tick counted once a day');
      // Food preferences: the ticked food is recorded once a day, with its id and name only
      const tickedId = await p.$eval('.tick-btn', b => +b.dataset.ate.split(':')[1]);
      const ate = store.food.filter(f => f.event === 'ate');
      ok(ate.length === 1 && ate[0].id === tickedId && typeof ate[0].name === 'string' && ate[0].name.length > 0, 'ate: ticked food recorded once (' + JSON.stringify(ate) + ')');
      ok(store.food.every(f => Object.keys(f).sort().join() === 'device,event,id,name'), 'food: only device id, event, food id and name are sent');
      const shown = await p.$$eval('#panel .swap[data-id]', bs => bs.map(b => +b.dataset.id));
      const out = shown[shown.length - 1];
      await p.click(`#panel .swap[data-id="${out}"]`); await wait(700);
      const now = await p.$$eval('#panel .swap[data-id]', bs => bs.map(b => +b.dataset.id));
      const sOut = store.food.filter(f => f.event === 'swap_out'), sIn = store.food.filter(f => f.event === 'swap_in');
      ok(sOut.length === 1 && sOut[0].id === out, 'swap: swapped-out food recorded');
      const fresh = [...new Set(now.filter(id => !shown.includes(id)))];
      ok(sIn.length === fresh.length && sIn.every(f => fresh.includes(f.id)) && !sIn.some(f => f.id === out), 'swap: new foods recorded as swapped in (' + sIn.map(f => f.id) + ' vs ' + fresh + ')');
      await p.click('#undo'); await wait(600);
      ok(store.food.filter(f => f.event === 'swap_in').length === sIn.length, 'undo is not counted as a swap');
      await p.click('[data-tab=shop]'); await wait(200); await p.click('[data-tab=day]'); await p.click('[data-tab=shop]'); await wait(200);
      ok(evs(store).filter(e => e === 'pro').length === 1, 'Pro card view counted once');
      const ids = new Set(store.usage.map(u => u.device));
      ok(ids.size === 1 && /^[0-9a-f-]{36}$/.test([...ids][0]), 'all events share one random device id');
      ok(store.usage.every(u => Object.keys(u).sort().join() === 'device,event'), 'only device id + event are sent');
      const before = store.usage.length;
      await p.reload(); await wait(400); if (await p.$('#guest')) { await p.click('#guest'); await wait(700); }
      ok(store.usage.length === before, 'reload the same day: nothing sent again');
      // next day: counted again
      await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mbp_seen')); s.d = '2000-01-01'; localStorage.setItem('mbp_seen', JSON.stringify(s)); });
      await p.reload(); await wait(400); await p.mouse.click(5, 5); await wait(300);
      ok(evs(store).filter(e => e === 'open').length === 2, 'new day: open counted again');
      ok(p.errors.length === 0, 'no errors ' + p.errors.join('|'));
      await p.context().close(); }

    // Offline: the send fails, so it's tried again next time
    { const store = makeStore(); store.offline = true; const p = await newDevice(b, store);
      await p.goto(APP); await wait(500);
      ok(store.usage.length === 0, 'offline: nothing recorded');
      await p.mouse.click(5, 5); await wait(300);
      ok(store.usage.length === 0, 'offline: nothing recorded');
      store.offline = false; await p.reload(); await wait(500); await p.mouse.click(5, 5); await wait(300);
      ok(evs(store).join() === 'open', 'back online: open sent on the next visit');
      ok(p.errors.length === 0, 'offline: no errors ' + p.errors.join('|'));
      await p.context().close(); }

    // Signed in: account counted
    { const store = makeStore(); const p = await newDevice(b, store, { session: A });
      await p.addInitScript(() => localStorage.setItem('mbp', JSON.stringify({ diet: 'egg', kitchen: true, place: 'home', step: 4, city: 'Pune', budget: 200, name: 'Asha' })));
      await p.goto(APP); await wait(1200);
      ok(evs(store).includes('account'), 'signed-in open counts account');
      await p.context().close(); }
    // Robots and the owner's own devices are not counted
    { const store = makeStore(); const p = await newDevice(b, store);
      await p.addInitScript(() => { window.__mbpCheckRobots = true; });
      await p.goto(APP); await wait(400); await p.mouse.click(5, 5); await p.keyboard.press('Tab'); await wait(300);
      ok(store.usage.length === 0, 'robot browser (webdriver / headless): nothing counted');
      await p.context().close(); }
    { const store = makeStore(); const p = await newDevice(b, store);
      await p.goto(APP + '?nocount=1'); await wait(400); await p.mouse.click(5, 5); await wait(300);
      ok(store.usage.length === 0 && !/nocount/.test(p.url()), 'own device (?nocount=1): nothing counted, link tidied');
      await p.reload(); await wait(400); await p.mouse.click(5, 5); await wait(300);
      ok(store.usage.length === 0, 'own device stays uncounted after a reload');
      await p.goto(APP + '?nocount=0'); await wait(400); await p.mouse.click(5, 5); await wait(300);
      ok(evs(store).join() === 'open', '?nocount=0 counts the device again');
      await p.context().close(); }
  } finally { await b.close(); }
  done();
})();
