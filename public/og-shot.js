// Renders the link-preview image (public/og.html -> site/og.png) and the app icons (from public/icon.svg)
// with the build machine's Chrome
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
(async () => {
  const b = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto('file://' + path.resolve('public/og.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'site/og.png' });
  // App icons: the rounded tile as is, and a "maskable" one (full-bleed square, logo inside the safe zone)
  const svg = fs.readFileSync('public/icon.svg', 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const icon = async (size, file, maskable) => {
    await p.setViewportSize({ width: size, height: size });
    const body = maskable
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" fill="#e8590c"/><g transform="translate(6.4 6.4) scale(.8)">${inner}</g></svg>`
      : svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${body}`);
    await p.screenshot({ path: 'site/' + file, omitBackground: true });
  };
  await icon(192, 'icon-192.png');
  await icon(512, 'icon-512.png');
  await icon(512, 'icon-maskable-512.png', true);
  // iPhone home screen: a plain square (iOS rounds the corners itself)
  await p.setViewportSize({ width: 180, height: 180 });
  await p.setContent(`<style>html,body{margin:0}svg{display:block}</style>${svg.replace(' rx="15"', '').replace('<svg ', '<svg width="180" height="180" ')}`);
  await p.screenshot({ path: 'site/apple-touch-icon.png' });
  await b.close();
})();
