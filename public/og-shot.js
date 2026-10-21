// Renders public/og.html to site/og.png (the link-preview image) with the build machine's Chrome
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto('file://' + require('path').resolve('public/og.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'site/og.png' });
  await b.close();
})();
