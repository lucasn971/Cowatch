// Test bout-en-bout v0.3 : tout passe par l'extension (panneau latéral) — invitation, voix, chat, synchro, alignement.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mk = dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const cA = await mk('/tmp/claude-0/v3a'), cB = await mk('/tmp/claude-0/v3b');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const extId = async c => new URL((await sw(c)).url()).host;
  const tabIdOf = async (c, urlPart) => (await sw(c)).evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u))?.id, urlPart);
  const errs = [];

  // --- Lucas : ouvre la vidéo, ouvre le panneau, crée le salon ---
  const vA = await cA.newPage(); await vA.goto(BASE + '/test-player.html?who=lucas');
  await vA.waitForFunction(() => document.querySelector('video').readyState >= 1);
  const idA = await extId(cA), tA = await tabIdOf(cA, 'who=lucas');
  const pA = await cA.newPage(); pA.on('pageerror', e => errs.push('A ' + e.message));
  await pA.goto(`chrome-extension://${idA}/panel.html?tab=${tA}&server=${encodeURIComponent(BASE)}`);
  await sleep(1500);
  ok((await pA.textContent('#playerStatus')).includes('détectée ✓'), 'panneau de Lucas détecte la vidéo de l\'onglet');
  await pA.fill('#name', 'Lucas'); await pA.click('#create');
  ok(await pA.isVisible('#choice') && await pA.locator('.card').count() === 6, 'écran « Ce soir, quelle ambiance ? » avec les 6 ambiances');
  await pA.click('#go');
  await pA.waitForSelector('#room:not(.hidden)');
  const code = await pA.textContent('#code');
  ok(/^[A-Z0-9]{5}$/.test(code), `salon créé depuis l'extension (${code})`);

  // --- Kylian : ouvre le lien d'invitation, l'extension le renvoie sur la vidéo avec le salon en attente ---
  const vB = await cB.newPage(); vB.on('pageerror', e => errs.push('B ' + e.message));
  await vB.goto(`${BASE}/j/${code}?u=${encodeURIComponent(BASE + '/test-player.html?who=kylian')}`);
  await vB.waitForSelector('#join-go:not([hidden])', { timeout: 8000 });
  ok(await vB.isHidden('#install'), 'page d\'invitation : extension détectée, étapes d\'installation masquées');
  await vB.click('#join-go'); await vB.waitForURL(/who=kylian/);
  await vB.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
  await sleep(1500);
  ok(await vB.locator('text=Rejoindre le salon ' + code).count() === 1, 'bulle « Rejoindre le salon » affichée sur la vidéo');
  const idB = await extId(cB), tB = await tabIdOf(cB, 'who=kylian');
  await (await sw(cB)).evaluate(() => chrome.storage.local.set({ name: 'Kylian' }));
  const pB = await cB.newPage(); pB.on('pageerror', e => errs.push('B ' + e.message));
  await pB.goto(`chrome-extension://${idB}/panel.html?tab=${tB}&server=${encodeURIComponent(BASE)}`);
  await pB.waitForSelector('#room:not(.hidden)', { timeout: 8000 });
  ok(await pB.textContent('#code') === code, 'Kylian rejoint automatiquement le salon de l\'invitation');

  // --- Voix ---
  await sleep(4000);
  const st = async p => p.$$eval('.peer', els => els.map(e => e.dataset.state || 'self'));
  ok((await st(pA)).includes('connected') && (await st(pB)).includes('connected'), `voix connectée dans les deux panneaux (${await st(pA)} | ${await st(pB)})`);
  ok((await pB.evaluate(() => chrome.runtime.sendMessage({ to: 'engine', cmd: 'stats' }))).audio >= 1, 'Kylian reçoit l\'audio de Lucas');

  // --- Chat ---
  await pA.fill('#chatIn', 'Ça commence !'); await pA.press('#chatIn', 'Enter'); await sleep(500);
  ok((await pB.textContent('#chat')).includes('LucasÇa commence !'), 'chat : message de Lucas reçu dans le panneau de Kylian');
  ok(await vB.evaluate(() => (document.querySelector('#cowatch-chat')?.innerText || '').includes('Ça commence !')), 'chat : message affiché aussi sur la vidéo de Kylian (bas droite)');
  // Réactions : elles montent sur la vidéo (couleur de la personne, sans pseudo) et ne vont pas dans le chat
  const chatBefore = await pA.textContent('#chat');
  await pB.click('#react button >> nth=1'); await sleep(500);
  const r1 = await vA.evaluate(() => { const e = document.querySelector('#cowatch-react .cw-rx'); return e ? { emoji: e.querySelector('.cw-emoji').textContent, who: e.querySelector('.cw-who').textContent, ring: e.querySelector('.cw-emoji').style.boxShadow } : null; });
  ok(r1 && r1.emoji === '🔥' && r1.who === 'Kylian' && /rgb|hsl/.test(r1.ring), `réaction de Kylian sur la vidéo de Lucas, avec son prénom et sa couleur (${r1 && r1.emoji} ${r1 && r1.who})`);
  await sleep(1600);
  await pB.evaluate(() => { const b = document.querySelectorAll('#react button'); for (let i = 0; i < 40; i++) b[1 + i % (b.length - 1)].click(); }); // avalanche (sans ⚽, qui déclenche le BUUUT)
  await sleep(700); await vA.screenshot({ path: '/tmp/claude-0/reactions.png' }); await sleep(800);
  const av = await vA.evaluate(() => ({ n: document.querySelectorAll('#cowatch-react .cw-rx').length, labels: [...document.querySelectorAll('#cowatch-react .cw-who')].map(e => e.textContent) }));
  ok(av.n >= 2 && av.n <= 14, `avalanche : l'écran reste lisible (${av.n} bulles, 14 au maximum)`);
  ok(av.labels.some(l => /×\d/.test(l)), `même émoji tapé plusieurs fois : une seule bulle qui grossit (${av.labels.join(' · ')})`);
  // Vestiaire : ⚽ = BUUUT, un seul par but
  await sleep(3200); await pB.click('#react button >> nth=0');
  let goal = false; for (let i = 0; i < 20 && !goal; i++) { await sleep(150); goal = await vA.evaluate(() => (document.querySelector('#cowatch-buuut')?.innerText || '').toUpperCase().includes('BUUUT')); }
  ok(goal, 'Vestiaire : ⚽ de Kylian → « BUUUT » sur la vidéo de Lucas');
  ok(await vA.evaluate(() => (document.querySelector('#cowatch-buuut')?.innerText || '').includes('Kylian l\'a crié en premier')), 'le BUUUT dit qui l\'a crié en premier');
  ok(await pB.isVisible('#goalBar'), 'celui qui a crié peut annuler (VAR)');
  await sleep(2200); await pA.click('#react button >> nth=0'); await sleep(900);
  ok(!(await vA.evaluate(() => (document.querySelector('#cowatch-buuut')?.innerText || '').includes('BUUUT'))), 'un seul BUUUT par but : le 2e ⚽ est une simple réaction');
  ok(await pA.textContent('#chat') === chatBefore, 'les réactions ne remplissent pas le chat');
  ok(!(await vA.evaluate(() => (document.querySelector('#cowatch-chat')?.innerText || '').includes('😂'))), 'ni les messages sur la vidéo');

  // --- Synchro série ---
  await vA.evaluate(async () => { const v = document.querySelector('video'); v.currentTime = 40; await new Promise(r => v.addEventListener('seeked', r, { once: true })); await v.play(); });
  await sleep(2500);
  const a1 = await vA.evaluate(() => document.querySelector('video').currentTime), b1 = await vB.evaluate(() => ({ t: document.querySelector('video').currentTime, p: !document.querySelector('video').paused }));
  ok(b1.p && Math.abs(a1 - b1.t) < 1, `lecture partagée via le panneau (Lucas ${a1.toFixed(2)} s / Kylian ${b1.t.toFixed(2)} s)`);
  await vB.evaluate(() => document.querySelector('video').pause()); await sleep(1200);
  ok(await vA.evaluate(() => document.querySelector('video').paused), 'pause de Kylian propagée à Lucas');

  // --- Mode match : calibration et alignement ---
  await vA.evaluate(() => document.querySelector('video').play()); await sleep(1500);
  await vA.evaluate(() => { document.querySelector('video').dataset.cowatchLive = '1'; }); await sleep(2000); // direct détecté tout seul
  ok((await pB.textContent('#syncedTxt')).length > 0, `direct détecté chez Kylian (« ${await pB.textContent('#syncedTxt')} »)`);
  for (const p of [pA, pB]) { await p.click('#menuBtn'); await p.click('#mCalib'); }
  ok(await pB.isVisible('#calib'), 'calage manuel (TV) accessible depuis le menu « … »');
  await pA.evaluate(() => { document.querySelector('#manual').open = true; }); await pB.evaluate(() => { document.querySelector('#manual').open = true; });
  await pA.click('#cStart'); await sleep(400);
  await pA.click('#top'); await sleep(2500); await pB.click('#top'); await sleep(500);
  ok((await pA.textContent('#cRes')).match(/Lucas2\.[4-7] s d'avance/), `calibration : ${await pA.textContent('#cRes')}`);
  await pA.click('#align'); await sleep(600);
  ok(await vA.evaluate(() => document.querySelector('video').paused), 'vidéo de Lucas (en avance) en pause');
  ok(!(await vB.evaluate(() => document.querySelector('video').paused)), 'vidéo de Kylian continue');
  await sleep(2600);
  ok(!(await vA.evaluate(() => document.querySelector('video').paused)), 'vidéo de Lucas relancée après ~2,5 s');

  // Mise à jour de l'extension : Cowatch se remet dans les onglets déjà ouverts (sans doublon s'il y est déjà)
  const n = await (await sw(cB)).evaluate(() => self.reinject());
  await sleep(800);
  ok(n >= 2, `réinjection dans les onglets ouverts : ${n} injection(s) réussie(s)`);
  await pA.fill('#chatIn', 'Toujours là'); await pA.press('#chatIn', 'Enter'); await sleep(800);
  const dup = await vB.evaluate(() => [...document.querySelectorAll('#cowatch-chat div')].filter(d => d.textContent.includes('Toujours là')).length);
  ok(dup === 1, `pas de doublon après réinjection (${dup} message affiché)`);

  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await pA.screenshot({ path: path.join(__dirname, 'panel-v3.png') });
  await cA.close(); await cB.close();
})().catch(e => { console.error(e); process.exit(1); });
