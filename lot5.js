// Lot 5 (23/10) : invitation qui ouvre la plateforme (Netflix compris), diagnostic automatique, récap de fin de match.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const SHOTS = '/tmp/claude-0/shots';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await sleep(150); } return false; };
require('fs').mkdirSync(SHOTS, { recursive: true });

(async () => {
  const mk = dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const cA = await mk('/tmp/claude-0/l5a'), cB = await mk('/tmp/claude-0/l5b');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const errs = [];
  async function open(c, who, name) {
    const s = await sw(c), id = new URL(s.url()).host;
    const v = await c.newPage(); v.on('pageerror', e => errs.push(name + ' page ' + e.message));
    await v.goto(`${BASE}/test-player.html?who=${who}`);
    await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
    const tab = await s.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u)).id, 'who=' + who);
    const p = await c.newPage(); p.on('pageerror', e => errs.push(name + ' ' + e.message));
    await p.setViewportSize({ width: 320, height: 900 });
    await p.goto(`chrome-extension://${id}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
    await p.fill('#name', name); return { s, v, p };
  }

  // --- 1. Invitation : la page /j/CODE garde l'adresse Netflix (avant : seules Canal+, TF1, Prime, YouTube passaient) ---
  const j = await cA.newPage();
  for (const [u, name] of [['https://www.netflix.com/watch/82035849', 'Netflix'], ['https://www.disneyplus.com/play/x', 'Disney+'], ['https://www.amazon.fr/gp/video/detail/x', 'Prime Video'], ['https://pirate.example/watch', '']]) {
    await j.goto(`${BASE}/j/ABCDE?u=${encodeURIComponent(u)}`);
    const d = await j.evaluate(() => ({ target: document.getElementById('join-data').dataset.target, where: document.getElementById('where').textContent }));
    ok(name ? d.target === u && d.where.includes(name) : d.target === '', `invitation vers ${name || 'un site hors liste'} : ${name ? 'la plateforme s\'ouvre' : 'refusée'}`);
  }
  await j.close();

  const A = await open(cA, 'lucas', 'Lucas'), B = await open(cB, 'kilian', 'Kilian');
  await A.p.click('#create'); await A.p.click('#go'); await A.p.waitForSelector('#room:not(.hidden)');
  const code = await A.p.textContent('#code');
  await B.p.fill('#codeIn', code); await B.p.click('#joinBtn'); await B.p.waitForSelector('#room:not(.hidden)');
  await sleep(2500);
  for (const P of [A, B]) await P.v.evaluate(() => { const v = document.querySelector('video'); v.muted = true; v.play(); });

  // --- 2. Diagnostic automatique : aucun souci => rien ; erreur de la vidéo => « Copier le rapport » ---
  ok(await B.p.isHidden('#issueBar'), 'aucun souci : pas de bandeau');
  await B.v.evaluate(() => document.querySelector('video').dispatchEvent(new Event('error')));
  ok(await until(() => B.p.isVisible('#issueBar')), 'erreur de la vidéo : « Petit souci détecté · Copier le rapport »');
  await B.p.click('#issueGo'); await sleep(4200);
  const rep = await B.p.inputValue('#diagOut');
  ok(rep.startsWith('DIAGNOSTIC COWATCH') && /erreur vidéo/.test(rep) && /entrée dans/.test(rep) && /connexion salon : ok/.test(rep), 'le rapport contient le journal (entrée, connexion, erreur vidéo)');
  ok(/"salon": "[A-Z0-9]+"/.test(rep) && /"frames"/.test(rep), 'le rapport contient l\'état du salon et l\'analyse du lecteur');
  ok(await B.p.isHidden('#issueBar'), 'rapport copié : le bandeau disparaît');

  // --- 3. Récap de fin de match ---
  for (const [P, h, a] of [[A, 2, 1], [B, 1, 0]]) { await P.p.fill('#pH', String(h)); await P.p.fill('#pA', String(a)); await P.p.click('#pGo'); }
  await sleep(600);
  await B.p.click('#react button:nth-child(1)'); // ⚽ = BUUUT
  for (let i = 0; i < 4; i++) { await B.p.click('#react button:nth-child(2)'); await sleep(120); } // 🔥 ×4
  await sleep(800);
  await B.p.click('#menuBtn'); ok(await B.p.isHidden('#mRecap'), 'Kilian (invité) ne siffle pas la fin'); await B.p.click('#menuBtn');
  await A.p.click('#menuBtn'); await A.p.click('#mRecap');
  ok(await A.p.isVisible('#recapEdit') && await A.p.isVisible('#rH'), 'Lucas : « Fin du match · récap » demande le score final');
  await A.p.fill('#rH', '2'); await A.p.fill('#rA', '1'); await A.p.click('#rGo');
  ok(await until(() => B.p.isVisible('#recap')), 'le récap s\'affiche chez Kilian');
  const rc = await B.p.textContent('#recap');
  ok(/2-1/.test(rc) && /Lucas\s*2-1\s*🎯 dans le mille/.test(rc) && /Kilian\s*1-0\s*✓ bon vainqueur/.test(rc), `pronos jugés : Lucas dans le mille, Kilian bon vainqueur`);
  ok(/1 BUUUT/.test(rc), 'le but est compté');
  ok(/Meilleurs moments/.test(rc) && /0:0\d\s*🔥 · 5 réactions/.test(rc), 'meilleur moment : 🔥 · 5 réactions, au bon instant de la vidéo');
  ok(/réactions · \d+ message/.test(rc), 'chiffres de la soirée');
  ok(await until(() => B.v.evaluate(() => { const e = document.getElementById('cowatch-recap'); return !!e && e.style.display !== 'none' && /Dans le mille/.test(e.textContent) && /Lucas/.test(e.textContent); })), 'carte du récap sur la vidéo (Dans le mille : Lucas)');
  await B.v.screenshot({ path: `${SHOTS}/recap-video.png` }); await B.p.screenshot({ path: `${SHOTS}/recap-panneau.png` });
  await B.p.click('#rClose'); ok(await until(() => B.p.isHidden('#recap')), 'le récap se ferme');
  ok(await A.p.isVisible('#recap'), 'fermer chez Kilian ne ferme pas chez Lucas');
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await cA.close(); await cB.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
