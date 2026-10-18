// Test bout-en-bout : 2 salons vocaux + 2 lecteurs synchronisés via l'extension.
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

  // ---- Partie 2 : synchro lecteur via l'extension ----
  const mk = async dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'] });
  const c1 = await mk('/tmp/claude-0/prof1'), c2 = await mk('/tmp/claude-0/prof2');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const p1 = await c1.newPage(), p2 = await c2.newPage();
  await p1.goto(BASE + '/test-player.html'); await p2.goto(BASE + '/test-player.html');
  for (const p of [p1, p2]) await p.waitForFunction(() => document.querySelector('video').readyState >= 1, null, { timeout: 15000 });
  await sleep(1500);
  const join = async (c, name) => (await sw(c)).evaluate(async ({ name }) => {
    const [t] = await chrome.tabs.query({ url: '*://localhost/*' });
    return await new Promise(r => chrome.runtime.onMessage.hasListeners() && self.dispatchEvent ? r(join(t.id, 'http://localhost:8080', 'SHORE-42', name)) : r(null));
  }, { name });
  ok((await join(c1, 'Lucas'))?.ok, 'lecteur 1 connecté au salon');
  await sleep(500);
  ok((await join(c2, 'Kylian'))?.ok, 'lecteur 2 connecté au salon');
  await sleep(1500);
  ok(await A.$eval('#syncpill', e => e.textContent).then(t => t.startsWith('2 lecteurs')), 'le salon voit les 2 lecteurs');
  // Lucas lance la lecture à 30 s
  await p1.evaluate(async () => { const v = document.querySelector('video'); v.currentTime = 30; await new Promise(r => v.addEventListener('seeked', r, { once: true })); await v.play(); });
  await sleep(2500);
  const t2 = await p2.evaluate(() => ({ t: document.querySelector('video').currentTime, p: !document.querySelector('video').paused }));
  const t1 = await p1.evaluate(() => document.querySelector('video').currentTime);
  ok(t2.p && Math.abs(t1 - t2.t) < 1, `play+seek propagé (L1 ${t1.toFixed(2)}s / L2 ${t2.t.toFixed(2)}s)`);
  // Kylian met pause
  await p2.evaluate(() => document.querySelector('video').pause());
  await sleep(1200);
  ok(await p1.evaluate(() => document.querySelector('video').paused), 'pause de L2 propagée à L1');
  // Dérive : L2 décroche de 10 s pendant la lecture, le pilote doit le recaler
  await p1.evaluate(() => document.querySelector('video').play()); await sleep(1500);
  await p2.evaluate(() => { window.__salonSyncTest = 1; }); // no-op
  await (await sw(c2)).evaluate(() => 0);
  await p2.evaluate(() => { const v = document.querySelector('video'); v.dispatchEvent(new Event('x')); });
  // simulate drift silently: change time without triggering emit (within ignore window is internal) -> use playbackRate
  await p2.evaluate(() => { document.querySelector('video').playbackRate = 2; });
  await sleep(7000);
  const d1 = await p1.evaluate(() => document.querySelector('video').currentTime), d2 = await p2.evaluate(() => document.querySelector('video').currentTime);
  ok(Math.abs(d1 - d2) < 2.5, `dérive corrigée par le pilote (écart ${Math.abs(d1 - d2).toFixed(2)}s)`);
  await p2.screenshot({ path: path.join(__dirname, 'player.png') });

  // ---- Partie 3 : mode match en direct (calibration TOP + alignement) ----
  await p2.evaluate(() => { document.querySelector('video').playbackRate = 1; });
  await A.click('#mode-live'); await sleep(600);
  ok(await B.isVisible('#calib'), 'mode match propagé au salon de B');
  await A.click('#calib-start'); await sleep(400);
  ok(await B.isVisible('#top'), 'B voit le bouton TOP');
  await A.click('#top');            // Lucas voit le moment en premier (flux en avance)
  await sleep(2500);
  await B.click('#top');            // Kylian 2,5 s plus tard (flux en retard)
  await sleep(500);
  const res = await A.$eval('#calib-res', e => e.textContent);
  ok(/Lucas2\.[4-7] s d'avance/.test(res) && res.includes('Kylianréférence'), `calibration calculée (${res})`);
  const k0 = await p2.evaluate(() => document.querySelector('video').currentTime);
  await A.click('#align'); await sleep(600);
  ok(await p1.evaluate(() => document.querySelector('video').paused), 'lecteur de Lucas (en avance) mis en pause');
  ok(!(await p2.evaluate(() => document.querySelector('video').paused)), 'lecteur de Kylian continue (pause non propagée en mode match)');
  ok((await A.$eval('#align-msg', e => e.textContent)).includes('Ton lecteur se met en pause'), 'Lucas voit le message d\'alignement');
  ok((await B.$eval('#align-msg', e => e.textContent)).includes('plus en retard'), 'Kylian voit qu\'il est la référence');
  await sleep(2600);
  ok(!(await p1.evaluate(() => document.querySelector('video').paused)), 'lecteur de Lucas relancé après ~2,5 s');
  await A.screenshot({ path: path.join(__dirname, 'salon-match.png'), fullPage: true });
  await c1.close(); await c2.close(); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
