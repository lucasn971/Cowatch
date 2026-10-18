// Test du salon web (amis sans extension, ex. sur téléphone) : voix, réactions, chat.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---- Partie 1 : salon vocal ----
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const A = await (await b.newContext()).newPage(), B = await (await b.newContext()).newPage();
  const errs = []; for (const p of [A, B]) p.on('pageerror', e => errs.push(e.message));
  await A.goto(BASE); await A.fill('#name', 'Lucas'); await A.fill('#room', 'SHORE-42'); await A.click('#go');
  await A.waitForSelector('#in:not(.hidden)');
  await B.goto(BASE + '/s/SHORE-42'); await B.fill('#name', 'Kylian'); await B.click('#go');
  await B.waitForSelector('#in:not(.hidden)');
  await sleep(4000);
  const sa = await A.$$eval('.peer .s', e => e.map(x => x.textContent));
  const sb = await B.$$eval('.peer .s', e => e.map(x => x.textContent));
  ok(sa.includes('en ligne') && sb.includes('en ligne'), `voix WebRTC connectée (A: ${sa.join(', ')} | B: ${sb.join(', ')})`);
  const audioOk = await B.evaluate(() => [...document.querySelectorAll('audio')].some(a => a.srcObject && a.srcObject.getAudioTracks().length));
  ok(audioOk, 'B reçoit la piste audio de A');
  await A.click('#react button:first-child'); await sleep(400);
  ok(await B.$('.fl') !== null, 'réaction de A affichée chez B');
  await A.fill('#chat-in', 'Allez le PSG !'); await A.press('#chat-in', 'Enter'); await sleep(400);
  ok((await B.$eval('#chat', e => e.textContent)).includes('Lucas Allez le PSG !'), 'chat écrit : message de A reçu par B');
  ok((await A.$eval('#chat', e => e.textContent)).includes('Toi Allez le PSG !'), 'chat écrit : A voit son propre message');
  await B.fill('#chat-in', '<b>pas de HTML</b>'); await B.click('#chat-send'); await sleep(400);
  ok(await A.$('#chat b') === null, 'chat écrit : le HTML n\'est pas interprété');
  const C = await (await b.newContext()).newPage(); await C.goto(BASE + '/s/SHORE-42'); await C.fill('#name', 'Kenzo'); await C.click('#go'); await C.waitForSelector('#in:not(.hidden)'); await sleep(800);
  ok((await C.$eval('#chat', e => e.textContent)).includes('Allez le PSG !'), 'chat écrit : historique reçu par un arrivant');
  await C.close();
  await A.screenshot({ path: path.join(__dirname, 'salon.png'), fullPage: true });
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
