// Test bout en bout de l'appli (sans téléphone) : deux « téléphones » simulés, chacun avec l'écran du salon et le lecteur
// injecté dans la page du site, reliés par l'appli native simulée (natif-simule.js) et le vrai serveur Cowatch.
// Lancement : node server.js (port 8080) dans un autre terminal, puis : node app/test/coque-e2e.js
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { Telephone } = require('./natif-simule');
const BASE = process.env.COWATCH_SERVER || 'http://localhost:8080';
const WWW = path.join(require('os').tmpdir(), 'cowatch-app-www');
const APP_PORT = 8091, APP = `http://localhost:${APP_PORT}/`;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (e) {} await sleep(150); } return false; };

(async () => {
  execFileSync(path.join(__dirname, '../outils/assembler-web.sh'), [WWW], { stdio: 'inherit' });
  // L'origine de l'appli (appassets.androidplatform.net sur Android) : ici un petit serveur de fichiers.
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff': 'font/woff', '.png': 'image/png' };
  const files = http.createServer((q, r) => {
    const p = path.join(WWW, decodeURIComponent(new URL(q.url, APP).pathname));
    if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'access-control-allow-origin': '*' }); fs.createReadStream(p).pipe(r);
  }).listen(APP_PORT);

  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errs = [], hotesSalon = new Set();
  const tel = async nom => {
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const t = new Telephone(ctx, nom, { www: WWW, base: APP });
    await t.ouvrir(`${APP}salon.html?tab=1&layout=bas&appv=0.1.0&server=${encodeURIComponent(BASE)}`);
    for (const p of [t.salon, t.lecteur]) p.on('pageerror', e => errs.push(`${nom} ${e.message}`));
    t.salon.on('request', r => { try { hotesSalon.add(new URL(r.url()).hostname); } catch (e) {} });
    return t;
  };

  // --- Téléphone d'Octave : salon ouvert, puis la vidéo ---
  const A = await tel('Octave');
  await A.chargerSalon();
  await A.lecteur.goto(`${BASE}/test-player.html?who=octave`);
  await A.lecteur.waitForFunction(() => document.querySelector('video').readyState >= 1);
  ok(await until(async () => (await A.salon.textContent('#playerStatus')).includes('détectée')), 'salon : la vidéo de la page du site est détectée à travers le pont');
  ok(await A.lecteur.evaluate(() => !(window.chrome && window.chrome.__coque)), 'la page du site ne voit pas l\'objet chrome de Cowatch (portée fermée)');
  await A.salon.fill('#name', 'Octave'); await A.salon.click('#create');
  ok(await A.salon.locator('.card').count() === 7, 'écran « Ce soir, quelle ambiance ? » avec les 7 ambiances');
  await A.salon.click('.card[data-id="anime"]').catch(() => {});
  await A.salon.click('#go');
  await A.salon.waitForSelector('#room:not(.hidden)', { timeout: 15000 });
  const code = (await A.salon.textContent('#code')).trim();
  ok(/^[A-Z0-9]{5}$/.test(code), `salon créé depuis l'appli (${code})`);
  ok(await until(() => A.log.room.some(r => r.inRoom && r.code === code)), 'l\'appli est prévenue de l\'entrée dans le salon (notification, écran allumé)');

  // --- Invitation : le bouton ouvre la feuille de partage du téléphone ---
  await A.salon.click('#invite');
  ok(await until(() => A.log.clip.some(c => c.share && c.text.includes(`/j/${code}`))), 'inviter : le lien …/j/CODE part dans la feuille de partage');

  // --- Téléphone d'Agathe : elle ouvre le lien (l'appli reçoit l'invitation), le salon la fait entrer ---
  const B = await tel('Agathe');
  await B.storageSet({ name: 'Agathe', pendingJoin: { code, at: Date.now() } }); // ce que fait l'appli à l'ouverture du lien
  await B.lecteur.goto(`${BASE}/test-player.html?who=agathe`);
  await B.lecteur.waitForFunction(() => document.querySelector('video').readyState >= 1);
  ok(await until(() => B.lecteur.locator(`text=Rejoindre le salon ${code}`).count().then(n => n === 1)), 'bulle « Rejoindre le salon » sur la vidéo d\'Agathe (invitation lue par le lecteur)');
  await B.chargerSalon();
  ok(await until(async () => (await B.salon.textContent('#code')).trim() === code, 15000), 'Agathe entre toute seule dans le salon de l\'invitation');

  // --- Voix ---
  const states = p => p.$$eval('.peer', els => els.map(e => e.dataset.state || 'self'));
  ok(await until(async () => (await states(A.salon)).includes('connected') && (await states(B.salon)).includes('connected'), 15000), `voix connectée entre les deux téléphones (${await states(A.salon)} | ${await states(B.salon)})`);

  // --- Synchro de la lecture ---
  await sleep(1500);
  await A.lecteur.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 4; return v.play(); });
  ok(await until(() => B.lecteur.evaluate(() => !document.querySelector('video').paused)), 'Octave lance la vidéo : elle démarre chez Agathe');
  ok(await until(() => B.lecteur.evaluate(() => Math.abs(document.querySelector('video').currentTime - 4) < 2.5)), 'Agathe est calée sur la position d\'Octave');
  await A.lecteur.evaluate(() => document.querySelector('video').pause());
  ok(await until(() => B.lecteur.evaluate(() => document.querySelector('video').paused)), 'Octave met en pause : pause chez Agathe');

  // --- Chat ---
  await A.salon.fill('#chatIn', 'Opening, on skip ?'); await A.salon.press('#chatIn', 'Enter');
  ok(await until(async () => (await B.salon.textContent('#chat')).includes('Opening, on skip ?')), 'chat : message reçu dans le salon d\'Agathe');
  ok(await until(() => B.lecteur.evaluate(() => (document.querySelector('#cowatch-chat')?.innerText || '').includes('Opening'))), 'chat : message affiché aussi sur la vidéo d\'Agathe');

  // --- Épisode suivant (idée reprise de Rave) : Octave change de vidéo, Agathe reçoit une proposition ---
  const ep2 = `${BASE}/test-player.html?who=octave&ep=2`;
  await A.lecteur.goto(ep2);
  ok(await until(() => B.salon.locator('#cw-suivre').count().then(n => n === 1)), 'Octave passe à l\'épisode suivant : proposition « Y aller » chez Agathe');
  ok(await A.salon.locator('#cw-suivre').count() === 0, 'pas de proposition chez Octave lui-même');
  await B.salon.click('#cw-suivre button.ghost');
  ok(await until(() => B.log.open.includes(ep2)), 'Agathe touche « Y aller » : son lecteur ouvre le même épisode');

  // --- Salon replié : languette sur la vidéo, qui le rouvre ---
  await B.setPanel(false);
  ok(await until(() => B.lecteur.locator('#cowatch-reopen').count().then(n => n === 1)), 'salon replié : la languette Cowatch apparaît sur la vidéo');
  await B.lecteur.click('#cowatch-reopen');
  ok(await until(() => B.panelOpen === true), 'toucher la languette déplie le salon');

  // --- Sécurité du pont : la page du site ne peut ni écrire dans les réglages ni appeler l'appli ---
  await B.lecteur.evaluate(() => window.__coqueTestPost(JSON.stringify({ k: 'call', id: 'x1', fn: 'storage.set', args: { items: { name: 'pirate' } } })));
  await B.lecteur.evaluate(() => window.__coqueTestPost(JSON.stringify({ k: 'call', id: 'x2', fn: 'open', args: { url: 'https://exemple.invalid' } })));
  await sleep(400);
  ok(B.store.name === 'Agathe' && B.log.refused.includes('storage.set') && B.log.refused.includes('open') && !B.log.open.includes('https://exemple.invalid'), 'le lecteur n\'a droit qu\'à lire l\'invitation : écriture et ouverture de page refusées');

  // Même règle que l'appli (Android : shouldInterceptRequest, iPhone : règles WebKit) : le salon ne joint que Cowatch et les polices.
  ok([...hotesSalon].every(h => ['localhost', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(h)), `zéro revente : le salon n'a contacté que le serveur Cowatch et les polices (${[...hotesSalon].join(', ')})`);
  ok(!errs.length, `aucune erreur JavaScript (${errs.slice(0, 3).join(' | ')})`);
  await browser.close(); files.close();
})().catch(e => { console.error(e); process.exitCode = 1; process.exit(); });
