// Plein écran du site (bouton Netflix / Canal+ / TF1) et languette « 💬 Cowatch » pour rouvrir le panneau.
// Kilian regarde dans un lecteur intégré (iframe), comme sur TF1 ou Canal+ : en plein écran, c'est ce lecteur qui affiche
// les visages et les messages. Retours de Lucas du 21/10 (19:05).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await sleep(200); } return false; };

(async () => {
  const mk = dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + path.resolve(__dirname, 'voice.wav')] });
  const cA = await mk('/tmp/claude-0/pa'), cB = await mk('/tmp/claude-0/pb');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const errs = [];
  async function open(c, who, name, inFrame) {
    const s = await sw(c), id = new URL(s.url()).host;
    const v = await c.newPage(); v.on('pageerror', e => errs.push(name + ' page ' + e.message));
    await v.goto(`${BASE}/test-player.html?who=${who}`);
    if (inFrame) { // le lecteur passe dans une iframe, avec son propre bouton plein écran (comme TF1)
      await v.evaluate(() => { document.body.innerHTML = '<iframe id="pl" src="/test-player.html?inner=1" style="width:800px;height:450px;border:0" allow="fullscreen"></iframe>'; });
      const f = await (await v.waitForSelector('#pl')).contentFrame();
      await f.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
      await f.evaluate(() => { const w = document.createElement('div'); w.id = 'box'; const vid = document.querySelector('video'); vid.before(w); w.append(vid);
        const b = document.createElement('button'); b.id = 'fs'; b.textContent = '⛶'; b.onclick = () => w.requestFullscreen(); document.body.prepend(b); });
    } else await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
    const tab = await s.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u)).id, 'who=' + who);
    const p = await c.newPage(); p.on('pageerror', e => errs.push(name + ' ' + e.message));
    await p.goto(`chrome-extension://${id}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
    await p.fill('#name', name); return { s, v, p, c, id, tab };
  }
  const A = await open(cA, 'lucas', 'Lucas'), B = await open(cB, 'kilian', 'Kilian', true);
  ok(await A.p.locator('#full').count() === 0, 'plus de bouton « Plein écran » Cowatch dans le panneau (on utilise celui du site)');
  await A.p.click('#create'); await A.p.click('#go'); await A.p.waitForSelector('#room:not(.hidden)');
  const code = await A.p.textContent('#code');
  await B.p.fill('#codeIn', code); await B.p.click('#joinBtn'); await B.p.waitForSelector('#room:not(.hidden)');
  await sleep(3000);
  const tabShown = () => B.v.evaluate(() => !!document.querySelector('#cowatch-reopen'));
  ok(!(await tabShown()), 'panneau ouvert : pas de languette sur la page');

  // Kilian ferme son panneau : la languette apparaît, avec le nombre de messages non lus
  await B.p.close();
  ok(await until(tabShown), 'panneau fermé : languette « 💬 Cowatch » sur le bord droit de la page');
  await A.p.fill('#chatIn', 'Tu es là ?'); await A.p.press('#chatIn', 'Enter');
  ok(await until(() => B.v.evaluate(() => (document.querySelector('#cowatch-reopen')?.textContent || '').includes('1'))), 'nouveau message : la languette affiche 1 message non lu');

  // Plein écran avec le bouton du lecteur (dans l'iframe) : languette cachée, visages et messages dans le lecteur
  const F = B.v.frame({ url: /inner=1/ });
  await B.v.bringToFront(); await F.click('#fs');
  ok(await until(() => F.evaluate(() => !!document.fullscreenElement)), 'plein écran du lecteur (bouton du site) activé');
  ok(await until(async () => !(await tabShown())), 'en plein écran : la languette est cachée');
  await A.p.fill('#chatIn', 'Quel but !'); await A.p.press('#chatIn', 'Enter');
  ok(await until(() => F.evaluate(() => !!document.fullscreenElement?.querySelector('#cowatch-chat') && document.fullscreenElement.querySelector('#cowatch-chat').innerText.includes('Quel but !'))), 'en plein écran (lecteur intégré) : le message s\'affiche sur la vidéo');
  ok(await until(() => F.evaluate(() => !!document.fullscreenElement?.querySelector('#cowatch-faces img, #cowatch-faces div[data-id]')), 20000), 'en plein écran (lecteur intégré) : visage de Lucas quand il parle');
  const st = await B.s.evaluate(() => chrome.runtime.sendMessage({ to: 'engine', cmd: 'stats' }));
  ok(st && st.inRoom && st.audio >= 1, `voix toujours active, panneau fermé et plein écran (${st && st.audio} voix reçue)`);

  // Sortie du plein écran : la languette revient
  await F.evaluate(() => document.exitFullscreen());
  ok(await until(tabShown), 'sortie du plein écran : la languette revient');
  await B.v.screenshot({ path: '/tmp/claude-0/languette.png' });

  // Clic sur la languette : demande d'ouverture du panneau
  await B.v.click('#cowatch-reopen');
  const opened = await until(async () => !(await tabShown()), 4000);
  ok(opened, 'clic sur la languette : le panneau Cowatch se rouvre');
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await cA.close(); await cB.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
