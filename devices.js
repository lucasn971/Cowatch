// Compatibilité appareils : téléphones, tablettes, ordinateur ; appli installable (PWA).
const { chromium, devices } = require('/opt/npm-tools/node_modules/playwright');
const BASE = 'http://localhost:8080';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const list = [['iPhone 13'], ['Pixel 7'], ['Galaxy S9+'], ['iPad Mini'], ['iPad Pro 11 landscape'], ['Galaxy Tab S4'], ['Galaxy Tab S4 landscape'], ['Desktop Chrome'], ['Desktop Firefox'], ['Desktop Safari'], ['Desktop Edge']];
  for (const [d] of list) {
    const ctx = await b.newContext({ ...devices[d] }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/s/DEVICES'); await p.fill('#name', d.split(' ')[0]); await p.click('#go'); await p.waitForSelector('#in:not(.hidden)');
    const r = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, twoCols: getComputedStyle(document.getElementById('in')).display === 'grid', w: innerWidth }));
    ok(r.over <= 0 && errs.length === 0, `${d} (${r.w}px) : salon sans débordement${r.twoCols ? ', voix et chat côte à côte' : ''}${errs.length ? ' ERREURS ' + errs.join(' | ') : ''}`);
    if (d === 'iPad Pro 11 landscape') await p.screenshot({ path: '/tmp/claude-0/ipad.png' });
    await ctx.close();
  }
  // Appli installable
  const p = await (await b.newContext()).newPage(); await p.goto(BASE + '/');
  const man = await (await fetch(BASE + '/manifest.webmanifest')).json();
  ok(man.display === 'standalone' && man.icons.length === 2, 'manifeste d\'appli servi (installable sur l\'écran d\'accueil)');
  const icons = await Promise.all(['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/sw.js'].map(async u => (await fetch(BASE + u)).status));
  ok(icons.every(s => s === 200), `icônes et service worker servis (${icons.join(', ')})`);
  await p.waitForTimeout(1500);
  ok(await p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), 'service worker enregistré');
  await b.close();
})();
