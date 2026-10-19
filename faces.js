// Test 0.5 : photo de profil, visage de celui qui parle sur la vidéo (y compris en plein écran), micro coupé, chat masquable.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// petite photo JPEG valide (carré corail) fabriquée par le navigateur
(async () => {
  const mk = dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + path.resolve(__dirname, 'voice.wav')] });
  const cA = await mk('/tmp/claude-0/fa'), cB = await mk('/tmp/claude-0/fb');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const errs = [];
  async function open(c, who, name) {
    const s = await sw(c), id = new URL(s.url()).host;
    const v = await c.newPage(); await v.goto(`${BASE}/test-player.html?who=${who}`);
    await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
    const tab = await s.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u)).id, 'who=' + who);
    const p = await c.newPage(); p.on('pageerror', e => errs.push(name + ' ' + e.message));
    await p.goto(`chrome-extension://${id}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
    await p.fill('#name', name); return { s, v, p };
  }
  const A = await open(cA, 'lucas', 'Lucas'), B = await open(cB, 'kilian', 'Kilian');
  // Lucas choisit une photo
  const png = await A.p.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 300; const g = c.getContext('2d'); g.fillStyle = '#ff5a3c'; g.fillRect(0, 0, 300, 300); return c.toDataURL('image/png'); });
  await A.p.setInputFiles('#photoIn', { name: 'moi.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
  await sleep(500);
  const av = await A.p.evaluate(() => chrome.storage.local.get('avatar').then(x => x.avatar || ''));
  ok(av.startsWith('data:image/jpeg') && av.length < 24000, `photo réduite et enregistrée (${av.length} caractères)`);
  ok(await A.p.locator('img#myAvatar').count() === 1, 'aperçu de la photo sur l\'accueil');
  await A.p.click('#create'); await A.p.waitForSelector('#room:not(.hidden)');
  const code = await A.p.textContent('#code');
  await B.p.fill('#codeIn', `${BASE}/j/${code}?u=${encodeURIComponent('https://www.canalplus.com/live/')}`); await B.p.click('#joinBtn'); // lien d'invitation collé tel quel await B.p.waitForSelector('#room:not(.hidden)');
  await sleep(4000);
  ok(await B.p.textContent('#code') === code, 'rejoindre en collant le lien d\'invitation complet');
  ok(await B.p.locator('.peer img.avatar').count() === 1, 'Kilian voit la photo de Lucas dans la liste');
  ok(await B.p.locator('.peer span.avatar').count() >= 1, 'sans photo : initiale à la place');
  // Le faux micro émet des bips : Lucas « parle » → son visage apparaît sur la vidéo de Kilian
  let seen = false;
  for (let i = 0; i < 80 && !seen; i++) { seen = await B.v.evaluate(() => !!document.querySelector('#cowatch-faces img')); if (!seen) await sleep(250); }
  ok(seen, 'visage de Lucas affiché sur la vidéo de Kilian quand il parle');
  // Plein écran (vrai geste utilisateur) : le calque suit l'élément en plein écran
  await B.v.evaluate(() => { const w = document.createElement('div'); w.id = 'wrap'; const v = document.querySelector('video'); v.before(w); w.append(v);
    const b = document.createElement('button'); b.id = 'fs'; b.textContent = 'plein écran'; b.onclick = () => w.requestFullscreen(); document.body.prepend(b); });
  await B.v.bringToFront(); await B.v.click('#fs'); await sleep(800);
  const fs = await B.v.evaluate(() => !!document.fullscreenElement);
  let inFs = false;
  for (let i = 0; i < 40 && !inFs; i++) { inFs = await B.v.evaluate(() => !!document.fullscreenElement?.querySelector('#cowatch-faces')); if (!inFs) await sleep(250); }
  ok(fs && inFs, 'en plein écran, les visages restent visibles (calque déplacé dans le plein écran)');
  // Raccourci micro : Kilian coupe son micro → pastille « Micro coupé »
  await (await sw(cB)).evaluate(() => chrome.runtime.sendMessage({ cmd: 'toggleMic' }));
  await sleep(600);
  ok(await B.v.evaluate(() => !!document.querySelector('[data-muted]')), 'raccourci Alt+Maj+M : pastille « Micro coupé » visible sur la vidéo');
  ok((await B.p.textContent('#mute')).includes('Réactiver'), 'le panneau reflète le micro coupé');
  // Messages : en bas à droite de la vidéo, même en plein écran ; aucun réglage à faire
  await A.p.fill('#chatIn', 'Quel but !'); await A.p.press('#chatIn', 'Enter'); await sleep(700);
  const chat = await B.v.evaluate(() => { const c = document.querySelector('#cowatch-chat'); if (!c) return null; const r = c.getBoundingClientRect(); return { txt: c.innerText, inFs: !!document.fullscreenElement?.contains(c), right: innerWidth - r.right, bottom: innerHeight - r.bottom }; });
  ok(chat && chat.txt.includes('Quel but !') && chat.inFs, 'message affiché sur la vidéo en plein écran');
  ok(chat && chat.right < 60 && chat.bottom < 200, `message placé en bas à droite (marges ${chat && Math.round(chat.right)} / ${chat && Math.round(chat.bottom)} px)`);
  const face = await B.v.evaluate(() => { const f = document.querySelector('#cowatch-faces'); const r = f.getBoundingClientRect(); return { left: r.left, top: r.top }; });
  ok(face.left < 40 && face.top < 40, 'photos de ceux qui parlent placées en haut à gauche');
  await B.v.screenshot({ path: path.join(__dirname, 'overlay.png') });
  ok(await B.p.locator('#opts, #optChat, #optFaces, #ptt').count() === 0, 'aucun réglage d\'affichage à faire dans le panneau');
  ok(errs.length === 0, 'aucune erreur JS' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await cA.close(); await cB.close();
})();
