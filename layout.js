// Affichage sur petits écrans : aucune page ne doit déborder en largeur.
const { chromium, devices } = require('/opt/npm-tools/node_modules/playwright');
const BASE = 'http://localhost:8080';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const d of ['iPhone SE', 'iPhone 13', 'Pixel 7', 'Galaxy S9+']) {
    const ctx = await b.newContext({ ...devices[d] }); const p = await ctx.newPage();
    const over = async () => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await p.goto(BASE + '/j/ABCDE?u=' + encodeURIComponent('https://www.canalplus.com/')); const j = await over();
    await p.goto(BASE + '/s/LAYOUT'); const a = await over();
    await p.fill('#name', 'Test'); await p.click('#go'); await p.waitForSelector('#in:not(.hidden)'); await p.click('#mode-live'); await p.waitForTimeout(300); const r = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(j <= 0 && a <= 0 && r <= 0, `${d} (${devices[d].viewport.width}px) : invitation ${j}, accueil ${a}, salon ${r} px de débordement`);
    if (d === 'iPhone SE') await p.screenshot({ path: '/tmp/claude-0/layout-se.png', fullPage: true });
    await ctx.close();
  }
  await b.close();
})();
