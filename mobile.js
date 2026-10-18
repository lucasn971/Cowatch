const { chromium, devices } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8080/j/ABCDE?u=' + encodeURIComponent('https://www.canalplus.com/live/'));
  const txt = await p.textContent('#noext'); console.log((txt.includes('téléphone') ? 'PASS' : 'FAIL') + ' invitation sur téléphone : ' + txt);
  await p.click('#noext'); await p.waitForURL(/\/s\/ABCDE/); console.log('PASS le bouton mène au salon web /s/ABCDE');
  await p.screenshot({ path: '/tmp/claude-0/mobile-join.png' });
  await b.close();
})();
