// Task 1: build bundles Supabase and config; no CDN scripts
const { execSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'); const out = path.join(root, 'macro-budget-planner.html'); const cfg = path.join(root, 'config.json');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const had = fs.existsSync(cfg) ? fs.readFileSync(cfg) : null;
  try {
    if (had) fs.unlinkSync(cfg);
    execSync('python3 build_local.py', { cwd: root, stdio: 'pipe' });
    let html = fs.readFileSync(out, 'utf8');
    ok(!/__SUPABASE__|__SUPA_URL__|__SUPA_KEY__/.test(html), 'placeholders filled');
    ok(!/cdn\.|jsdelivr/.test(html), 'no CDN references');
    const b = await chromium.launch(); const p = await b.newPage();
    await p.route('**fonts.g*/**', r => r.abort());
    await p.goto('file://' + out);
    ok(await p.evaluate(() => typeof supabase !== 'undefined' && typeof supabase.createClient === 'function'), 'supabase.createClient bundled');
    await b.close();
    fs.writeFileSync(cfg, JSON.stringify({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'pk_test' }));
    execSync('python3 build_local.py', { cwd: root, stdio: 'pipe' });
    html = fs.readFileSync(out, 'utf8');
    ok(html.includes('https://x.supabase.co') && html.includes('pk_test'), 'config values inserted');
  } finally {
    if (fs.existsSync(cfg)) fs.unlinkSync(cfg);
    if (had) fs.writeFileSync(cfg, had);
    execSync('python3 build_local.py', { cwd: root, stdio: 'pipe' });
  }
  console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
