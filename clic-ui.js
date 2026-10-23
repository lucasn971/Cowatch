// Essai de Lucas (23/10, 16:17) : en plein écran, un clic sur la languette Cowatch mettait la vidéo en pause (comme Netflix
// qui met en pause au clic), et la synchro mettait en pause tout le salon. Ici, un faux lecteur « à la Netflix »
// met en pause sur mousedown (écouteur en capture sur document) et sur click (sur son conteneur).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await sleep(150); } return false; };

(async () => {
  const mk = dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const cA = await mk('/tmp/claude-0/cua'), cB = await mk('/tmp/claude-0/cub');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const errs = [];
  async function open(c, who, name) {
    const s = await sw(c), id = new URL(s.url()).host;
    const v = await c.newPage(); v.on('pageerror', e => errs.push(name + ' page ' + e.message));
    await v.goto(`${BASE}/test-player.html?who=${who}`);
    await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
    await v.evaluate(() => {
      const w = document.createElement('div'); w.id = 'box'; const vid = document.querySelector('video'); vid.controls = false; vid.before(w); w.append(vid);
      const toggle = () => { window.sitePauses = (window.sitePauses || 0) + 1; vid.paused ? vid.play() : vid.pause(); };
      document.addEventListener('mousedown', e => { if (w.contains(e.target)) { window.lastDown = Date.now(); } }, true);
      w.addEventListener('click', () => toggle()); // clic dans le lecteur = pause / lecture
      document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { window.fsPauses = (window.fsPauses || 0) + 1; vid.pause(); } }); // lecteur qui se met en pause en sortant du plein écran
      const b = document.createElement('button'); b.id = 'fs'; b.textContent = '⛶'; b.onclick = () => w.requestFullscreen(); document.body.prepend(b);
    });
    const tab = await s.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u)).id, 'who=' + who);
    const p = await c.newPage(); p.on('pageerror', e => errs.push(name + ' ' + e.message));
    await p.goto(`chrome-extension://${id}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
    await p.fill('#name', name); return { s, v, p };
  }
  const A = await open(cA, 'lucas', 'Lucas'), B = await open(cB, 'kilian', 'Kilian');
  await A.p.click('#create'); await A.p.click('#go'); await A.p.waitForSelector('#room:not(.hidden)');
  await B.p.fill('#codeIn', await A.p.textContent('#code')); await B.p.click('#joinBtn'); await B.p.waitForSelector('#room:not(.hidden)');
  await sleep(2500);
  for (const P of [A, B]) await P.v.evaluate(() => { const v = document.querySelector('video'); v.muted = true; v.play(); });
  await sleep(1500);
  await A.p.fill('#pH', '1'); await A.p.fill('#pA', '0'); await A.p.click('#pGo'); // pour avoir le volet prono
  await A.v.bringToFront(); await A.v.click('#fs'); await sleep(1200);
  const playing = P => P.v.evaluate(() => !document.querySelector('video').paused);
  const pauses = () => A.v.evaluate(() => window.sitePauses || 0);
  ok(await until(() => A.v.evaluate(() => !!document.fullscreenElement?.querySelector('#cowatch-reopen'))), 'plein écran : languette visible');

  // Barre d'émojis
  await A.v.mouse.move(400, 300); await sleep(300);
  const bar = await A.v.$('#cowatch-bar button'); await bar.click(); await sleep(800);
  ok(await pauses() === 0 && await playing(A), 'clic sur un émoji de la barre : pas de pause');
  ok(await until(() => B.v.evaluate(() => !!document.querySelector('[id^="cowatch-"]') && true)), 'la réaction part bien');
  // Volet prono
  await (await A.v.$('#cowatch-prono')).click(); await sleep(600);
  ok(await pauses() === 0 && await playing(A), 'clic sur le volet prono : pas de pause');
  // Languette (rouvre le panneau, sort du plein écran)
  await (await A.v.$('#cowatch-reopen')).click(); await sleep(1500);
  ok(await A.v.evaluate(() => window.fsPauses === 1), 'le faux lecteur s\'est bien mis en pause en sortant du plein écran');
  ok(await pauses() === 0 && await playing(A), 'clic sur la languette en plein écran : la lecture continue chez Lucas');
  ok(await playing(B), 'et pas de pause chez Kilian (la synchro n\'a rien envoyé)');
  ok(await A.v.evaluate(() => !document.fullscreenElement), 'la languette sort bien du plein écran');
  // Le lecteur du site marche toujours normalement : un clic sur la vidéo elle-même met en pause, chez tout le monde
  await sleep(2600); await A.v.click('video', { position: { x: 100, y: 100 } }); await sleep(1500);
  const st = await A.v.evaluate(() => ({ n: window.sitePauses || 0, paused: document.querySelector('video').paused }));
  ok(st.n === 1 && st.paused, `clic sur la vidéo elle-même : le site met en pause comme avant (${JSON.stringify(st)})`);
  ok(await until(async () => !(await playing(B)), 5000), 'cette pause-là est partagée avec Kilian (synchro intacte)');
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await cA.close(); await cB.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
