// Micro refusé au départ puis autorisé : l'invité active son micro après coup et l'autre l'entend.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const bA = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const bB = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const A = await (await bA.newContext()).newPage(); const ctxB = await bB.newContext(); const B = await ctxB.newPage();
  // Simule Safari qui refuse le micro la première fois (comme sur l'iPhone du frère), puis l'accepte.
  await B.addInitScript(() => { const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let n = 0;
    navigator.mediaDevices.getUserMedia = c => (n++ === 0 ? Promise.reject(new DOMException('refusé', 'NotAllowedError')) : real(c)); });
  const errs = []; for (const p of [A, B]) p.on('pageerror', e => errs.push(e.message));
  await A.goto('http://localhost:8080/'); await A.fill('#name', 'Lucas'); await A.fill('#room', 'MICTEST'); await A.click('#go'); await A.waitForSelector('#in:not(.hidden)');
  await B.goto('http://localhost:8080/s/MICTEST'); await B.fill('#name', 'Frere'); await B.click('#go'); await B.waitForSelector('#in:not(.hidden)');
  await sleep(3000);
  ok(await B.isVisible('#micOn'), 'micro refusé : bouton « Activer mon micro » affiché');
  ok((await B.textContent('#micMsg')).length > 20, 'message d\'aide affiché : ' + (await B.textContent('#micMsg')).slice(0, 70) + '…');
  ok(await B.evaluate(() => [...document.querySelectorAll('audio')].some(a => a.srcObject?.getAudioTracks().length)), 'le frère entend quand même Lucas');
  await B.click('#micOn'); await sleep(3500);
  ok(await B.isHidden('#micOn'), 'micro activé après coup');
  const heard = await A.evaluate(() => [...document.querySelectorAll('audio')].some(a => a.srcObject?.getAudioTracks().some(t => t.readyState === 'live')));
  const states = await A.$$eval('.peer .s', e => e.map(x => x.textContent));
  ok(heard && states.includes('en ligne'), `Lucas reçoit maintenant la voix du frère (${states.join(', ')})`);
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await B.screenshot({ path: '/tmp/claude-0/mic-retry.png' });
  await bA.close(); await bB.close();
})().catch(e => { console.error(e); process.exit(1); });
