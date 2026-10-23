// 0.9.2 — ambiances et fonctions de la passation Design (22/10) :
// ambiance choisie par le salon et changée par son créateur seul, prono, micro en pastille,
// BUUUT zéro spoil (affiché quand le but arrive dans MA vidéo) et VAR, plein écran (languette visible, barre d'émojis).
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
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + path.resolve(__dirname, 'voice.wav')] });
  const cA = await mk('/tmp/claude-0/aa'), cB = await mk('/tmp/claude-0/ab');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const errs = [];
  async function open(c, who, name) {
    const s = await sw(c), id = new URL(s.url()).host;
    const v = await c.newPage(); v.on('pageerror', e => errs.push(name + ' page ' + e.message));
    await v.goto(`${BASE}/test-player.html?who=${who}`);
    await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
    await v.evaluate(() => { const w = document.createElement('div'); w.id = 'box'; const vid = document.querySelector('video'); vid.before(w); w.append(vid);
      const b = document.createElement('button'); b.id = 'fs'; b.textContent = '⛶'; b.onclick = () => w.requestFullscreen(); document.body.prepend(b); });
    const tab = await s.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u)).id, 'who=' + who);
    const p = await c.newPage(); p.on('pageerror', e => errs.push(name + ' ' + e.message));
    await p.setViewportSize({ width: 320, height: 860 });
    await p.goto(`chrome-extension://${id}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
    await p.fill('#name', name); return { s, v, p };
  }
  const A = await open(cA, 'lucas', 'Lucas'), B = await open(cB, 'kilian', 'Kilian');

  // --- Lucas crée le salon en choisissant « Soirée canapé » ---
  await A.p.click('#create'); await A.p.screenshot({ path: `${SHOTS}/choix.png` });
  ok(await A.p.locator('.card[data-id="manga"][aria-disabled="true"]').count() === 1, 'Manga affiché « bientôt » (couleur pas encore tranchée)');
  await A.p.click('.card[data-id="canape"]');
  ok((await A.p.textContent('#pickedName')) === 'Soirée canapé', 'choix : Soirée canapé');
  await A.p.click('#go'); await A.p.waitForSelector('#room:not(.hidden)');
  const code = await A.p.textContent('#code');
  ok(await A.p.evaluate(() => document.documentElement.dataset.theme) === 'canape', 'panneau de Lucas en Soirée canapé');
  ok(await A.p.textContent('#invite') !== '' && (await A.p.$$eval('#react button', b => b.map(x => x.textContent).join(''))) === '😱😂💔👀🔥🍿', 'émojis propres à l\'ambiance');

  // --- Kilian rejoint : même ambiance, mais il ne peut pas la changer ---
  await B.p.fill('#codeIn', code); await B.p.click('#joinBtn'); await B.p.waitForSelector('#room:not(.hidden)');
  ok(await until(() => B.p.evaluate(() => document.documentElement.dataset.theme === 'canape')), 'Kilian arrive dans la même ambiance (choisie par le salon)');
  await B.p.click('#menuBtn');
  ok(await B.p.isHidden('#mTheme'), 'Kilian ne voit pas « Changer d\'ambiance » (réservé au créateur)');
  await B.p.click('#menuBtn');
  await sleep(2500);
  await A.p.screenshot({ path: `${SHOTS}/panneau-canape.png` });

  // Captures de chaque ambiance (pour validation), puis retour au Vestiaire
  for (const id of ['salle', 'live', 'arene', 'vestiaire']) {
    await A.p.click('#menuBtn'); await A.p.click('#mTheme'); await A.p.click(`.card[data-id="${id}"]`); await A.p.click('#go');
    await until(() => B.p.evaluate(i => document.documentElement.dataset.theme === i, id));
    await sleep(700); await A.p.screenshot({ path: `${SHOTS}/panneau-${id}.png` });
  }
  ok(await B.p.evaluate(() => document.documentElement.dataset.theme) === 'vestiaire', 'le créateur change l\'ambiance : elle change chez tout le monde');
  ok((await B.p.textContent('#chat')).includes('Ambiance : Vestiaire'), 'changement annoncé par une pastille courte');

  // --- Prono d'avant-match ---
  await A.p.fill('#pH', '2'); await A.p.fill('#pA', '1'); await A.p.click('#pGo');
  await B.p.fill('#pH', '2'); await B.p.fill('#pA', '1'); await B.p.click('#pGo');
  ok(await until(() => B.p.evaluate(() => !document.querySelector('#pronoDone').classList.contains('hidden') && document.querySelector('#pronoMine').textContent === '2-1')), 'prono validé : le bloc se replie en une ligne « Ton prono 2-1 · modifier »');
  ok(await until(() => B.v.evaluate(() => { const b = document.querySelector('#cowatch-prono'); if (!b) return false; const r = b.getBoundingClientRect(); return b.innerText.includes('2-1') && r.left <= 1 && r.top > innerHeight * .25; })), 'prono du groupe : petit volet sur le bord gauche, à mi-hauteur (loin du score et du chrono)');
  await B.v.hover('#cowatch-prono');
  ok(await until(() => B.v.evaluate(() => { const t = document.querySelector('#cowatch-prono').innerText; return t.includes('Lucas') && t.includes('Kilian'); })), 'au survol, le volet déroule le prono de chacun');
  await B.v.mouse.move(600, 500);

  // --- Micro : pastille sur l'avatar, plus de message dans le chat ---
  const chat0 = await A.p.textContent('#chat');
  await B.p.click('#mute');
  ok(await until(() => A.p.evaluate(() => !!document.querySelector('.peer:not([data-self="1"]) .mutedBadge'))), 'Kilian coupe son micro : pastille 🔇 sur son avatar chez Lucas');
  ok(!(await A.p.textContent('#chat')).replace(chat0, '').includes('Micro'), 'aucun message « micro » dans le chat');
  await B.p.click('#mute');

  // --- BUUUT zéro spoil : un « robot » crie but avec 3 s d'avance sur la vidéo de Kilian ---
  await A.v.evaluate(() => document.querySelector('video').play()); await sleep(2500);
  const robot = new WebSocket(BASE.replace('http', 'ws'));
  const said = [];
  await new Promise(r => robot.onopen = r);
  robot.onmessage = e => said.push(JSON.parse(e.data));
  robot.send(JSON.stringify({ t: 'join', room: code, name: 'Robot', kind: 'salon', cid: 'robot-test' }));
  await until(async () => said.some(m => m.t === 'welcome'));
  await sleep(1500);
  // VAR d'abord : but annoncé 4 s en avance puis refusé tout de suite → Kilian ne voit rien
  let t = await B.v.evaluate(() => document.querySelector('video').currentTime);
  robot.send(JSON.stringify({ t: 'reaction', emoji: '⚽', pos: t + 4, kind: 'media' }));
  await until(async () => said.some(m => m.t === 'goal'));
  robot.send(JSON.stringify({ t: 'goal-cancel', id: said.find(m => m.t === 'goal').id }));
  await sleep(5500);
  ok(!(await B.v.evaluate(() => (document.querySelector('#cowatch-buuut')?.innerText || '').length > 0)), 'VAR : but refusé avant qu\'il arrive dans la vidéo de Kilian → rien ne s\'affiche');
  // Puis un vrai but, 3 s en avance sur Kilian
  t = await B.v.evaluate(() => document.querySelector('video').currentTime);
  robot.send(JSON.stringify({ t: 'reaction', emoji: '⚽', pos: t + 3, kind: 'media' }));
  const t0 = Date.now();
  await sleep(1800);
  ok(!(await B.v.evaluate(() => (document.querySelector('#cowatch-buuut')?.innerText || '').length > 0)), 'zéro spoil : rien chez Kilian avant que le but arrive dans sa vidéo');
  const seen = await until(() => B.v.evaluate(() => (document.querySelector('#cowatch-buuut')?.innerText || '').toUpperCase().includes('BUUUT')), 4000);
  const at = (Date.now() - t0) / 1000;
  ok(seen && at > 2.3 && at < 4.5, `BUUUT affiché quand le but arrive dans la vidéo de Kilian (après ${at.toFixed(1)} s pour 3 s d'avance)`);
  await sleep(250); await B.v.screenshot({ path: `${SHOTS}/buuut.png` });
  robot.close();

  // --- Plein écran du site : languette visible, barre d'émojis ---
  await B.v.bringToFront(); await B.v.click('#fs');
  ok(await until(() => B.v.evaluate(() => !!document.fullscreenElement)), 'plein écran du site');
  ok(await until(() => B.v.evaluate(() => !!document.fullscreenElement?.querySelector('#cowatch-reopen'))), 'en plein écran : la languette reste visible (discrète)');
  await B.v.mouse.move(400, 300); await B.v.mouse.move(420, 320);
  ok(await until(() => B.v.evaluate(() => { const b = document.fullscreenElement?.querySelector('#cowatch-bar'); return b && b.children.length === 6 && b.style.opacity === '1'; })), 'en plein écran : barre de 6 émojis de l\'ambiance en bas au centre');
  await A.p.fill('#chatIn', 'Lâche pas, mon chum !'); await A.p.press('#chatIn', 'Enter');
  ok(await until(() => B.v.evaluate(() => /[1-9]/.test(document.querySelector('#cowatch-reopen')?.textContent || ''))), 'nouveau message en plein écran : compteur sur la languette');
  await B.v.screenshot({ path: `${SHOTS}/plein-ecran.png` });
  await B.v.evaluate(() => document.querySelector('#cowatch-bar button:nth-child(2)').click());
  ok(await until(() => A.v.evaluate(() => [...document.querySelectorAll('#cowatch-react .cw-rx')].some(e => e.textContent.includes('🔥') && e.textContent.includes('Kilian')))), 'réaction envoyée depuis la barre du plein écran : Lucas la voit');
  await B.v.click('#cowatch-reopen');
  ok(await until(() => B.v.evaluate(() => !document.fullscreenElement)), 'clic sur la languette en plein écran : on sort du plein écran pour ouvrir le panneau');

  // --- Pluie d'émojis : au-delà de 3 clics rapides sur le même émoji ---
  await B.p.evaluate(() => { const b = document.querySelectorAll('#react button')[1]; let i = 0; const t = setInterval(() => { b.click(); if (++i >= 7) clearInterval(t); }, 150); });
  ok(await until(() => A.v.evaluate(() => document.querySelectorAll('#cowatch-rain .cw-drop').length >= 3)), `clics répétés : pluie d'émojis (${await A.v.evaluate(() => document.querySelectorAll('#cowatch-rain .cw-drop').length)} gouttes)`);
  ok(await A.v.evaluate(() => [...document.querySelectorAll('#cowatch-react .cw-rx')].filter(e => e.textContent.includes('🔥')).length <= 1), 'pas une bulle qui grossit sans fin : une seule bulle (taille 3 max) + la pluie');
  await A.v.screenshot({ path: `${SHOTS}/pluie.png` });

  // --- Panneau replié (sans plein écran) : la vidéo prend la place, barre d'émojis et languette comme sur la maquette ---
  await B.p.close();
  await B.v.bringToFront(); await B.v.mouse.move(300, 300); await B.v.mouse.move(320, 330);
  ok(await until(() => B.v.evaluate(() => { const b = document.querySelector('#cowatch-bar'); return !document.fullscreenElement && b && b.children.length === 6 && b.style.opacity === '1'; })), 'panneau replié : barre d\'émojis en bas au centre, même sans plein écran');
  ok(await B.v.evaluate(() => !!document.querySelector('#cowatch-reopen')), 'panneau replié : languette pour le rouvrir');
  await B.v.screenshot({ path: `${SHOTS}/replie.png` });

  // --- « Moins d'animations » : les réactions s'affichent sans mouvement ---
  await A.v.emulateMedia({ reducedMotion: 'reduce' });
  await A.p.click('#react button >> nth=2');
  ok(await until(() => A.v.evaluate(() => [...document.querySelectorAll('#cowatch-react .cw-rx')].some(e => e.textContent.includes('😤')))), 'moins d\'animations : la réaction s\'affiche quand même, sans mouvement');
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await cA.close(); await cB.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
