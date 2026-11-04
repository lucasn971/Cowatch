// Mode A (Android) sans téléphone : Octave regarde dans l'APPLI OFFICIELLE (Netflix simulé, piloté par la page « pilote »),
// Agathe sur le site dans l'appli Cowatch (mode B). Le salon, le serveur et coeur/player.js sont les vrais.
// Lancement : node server.js (port 8080), puis : node app/test/appli-officielle-e2e.js
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { Telephone, AppliSimulee } = require('./natif-simule');
const BASE = process.env.COWATCH_SERVER || 'http://localhost:8080';
const WWW = path.join(require('os').tmpdir(), 'cowatch-app-www-a');
const APP_PORT = 8092, APP = `http://localhost:${APP_PORT}/`;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (e) {} await sleep(150); } return false; };

(async () => {
  execFileSync(path.join(__dirname, '../outils/assembler-web.sh'), [WWW], { stdio: 'inherit' });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff': 'font/woff', '.png': 'image/png' };
  const files = http.createServer((q, r) => {
    const p = path.join(WWW, decodeURIComponent(new URL(q.url, APP).pathname));
    if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
  }).listen(APP_PORT);
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errs = [];
  const tel = async nom => {
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const t = new Telephone(ctx, nom, { www: WWW, base: APP });
    await t.ouvrir(`${APP}salon.html?tab=1&layout=bas&appv=0.1.3&server=${encodeURIComponent(BASE)}`);
    for (const p of [t.salon, t.lecteur]) p.on('pageerror', e => errs.push(`${nom} ${e.message}`));
    return t;
  };

  // --- Octave : l'appli Cowatch en mode A, avec Netflix (simulé) ouvert à côté ---
  const A = await tel('Octave');
  const netflix = new AppliSimulee('com.netflix.mediaclient', 'Netflix');
  await A.chargerSalon();
  await A.ouvrirPilote(`${APP}pilote.html`, netflix);
  A.pilote.on('pageerror', e => errs.push(`Octave pilote ${e.message}`));
  ok(await until(async () => (await A.salon.textContent('#playerStatus')).includes('détectée')), 'mode A : le lecteur de l\'appli officielle est vu par le salon comme une vidéo');
  await A.salon.fill('#name', 'Octave'); await A.salon.click('#create');
  await A.salon.click('.card[data-id="anime"]').catch(() => {});
  await A.salon.click('#go');
  await A.salon.waitForSelector('#room:not(.hidden)', { timeout: 15000 });
  const code = (await A.salon.textContent('#code')).trim();
  ok(/^[A-Z0-9]{5}$/.test(code), `salon créé (${code})`);

  // --- Agathe : site dans l'appli (mode B) ---
  const B = await tel('Agathe');
  await B.storageSet({ name: 'Agathe', pendingJoin: { code, at: Date.now() } });
  await B.lecteur.goto(`${BASE}/test-player.html?who=agathe`);
  await B.lecteur.waitForFunction(() => document.querySelector('video').readyState >= 1);
  await B.chargerSalon();
  ok(await until(async () => (await B.salon.textContent('#code')).trim() === code, 15000), 'Agathe entre dans le salon');
  await sleep(1500);

  // 1. Octave lance l'épisode DANS L'APPLI NETFLIX (pas dans Cowatch) : Agathe suit.
  netflix.utilisateur('play', 10); // (la vidéo d'essai d'Agathe dure 120 s)
  ok(await until(() => B.lecteur.evaluate(() => !document.querySelector('video').paused)), 'lecture lancée dans l\'appli officielle → la vidéo d\'Agathe démarre');
  const vb = () => B.lecteur.evaluate(() => document.querySelector('video').currentTime);
  ok(await until(async () => Math.abs((await vb()) - netflix.position()) < 2.5), `Agathe calée sur la position de l'appli officielle (${netflix.position().toFixed(1)} s)`);

  // 2. Agathe met en pause : Cowatch commande la pause à l'appli officielle d'Octave.
  // (Une action faite moins de 0,7 s après un calage reçu est ignorée par player.js, comme sur un site : on laisse passer ce délai.)
  await sleep(1500);
  const avant = netflix.cmds.length;
  await B.lecteur.evaluate(() => document.querySelector('video').pause());
  ok(await until(() => netflix.cmds.includes('media.pause') && !netflix.playing), 'pause chez Agathe → pause commandée à l\'appli officielle d\'Octave');

  await sleep(1500);
  // 3. Agathe avance à 60 s et relance : l'appli officielle est déplacée puis relancée.
  await B.lecteur.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 60; return v.play(); });
  ok(await until(() => netflix.cmds.some(c => /^media\.seek (5[89]|6[0-2])$/.test(c)) && netflix.playing, 10000), `avance + lecture chez Agathe → l'appli officielle va à ≈ 60 s et repart (${netflix.cmds.slice(avant).join(', ')})`);
  ok(await until(() => Math.abs(netflix.position() - 62) < 4), `position de l'appli officielle ≈ 60 s (+ lecture) (${netflix.position().toFixed(1)})`);

  // 4. Pas d'écho : nos propres ordres ne reviennent pas comme des actions d'Octave.
  await sleep(4000);
  const n = netflix.cmds.length - avant;
  ok(n <= 6, `pas de ping-pong entre l'appli officielle et le salon (${n} ordres envoyés en tout)`);
  ok(!(await B.lecteur.evaluate(() => document.querySelector('video').paused)), 'la lecture continue chez Agathe après le calage');

  // 5. Octave met en pause dans l'appli officielle : pause chez Agathe.
  netflix.utilisateur('pause');
  ok(await until(() => B.lecteur.evaluate(() => document.querySelector('video').paused)), 'pause dans l\'appli officielle → pause chez Agathe');

  // 6. La page pilote n'a droit qu'aux commandes de lecture.
  await A.pilote.evaluate(() => window.__coqueTestPost(JSON.stringify({ k: 'call', id: 'x1', fn: 'open', args: { url: 'https://exemple.invalid' } })));
  await A.pilote.evaluate(() => window.__coqueTestPost(JSON.stringify({ k: 'call', id: 'x2', fn: 'storage.set', args: { items: { name: 'x' } } })));
  await sleep(300);
  ok(A.log.refused.includes('pilote:open') && A.log.refused.includes('pilote:storage.set') && !A.log.open.length, 'la page pilote ne peut que lire et commander la lecture (ouvrir une page, écrire les réglages : refusé)');

  ok(!errs.length, `aucune erreur JavaScript (${errs.slice(0, 3).join(' | ')})`);
  await browser.close(); files.close();
})().catch(e => { console.error(e); process.exitCode = 1; process.exit(); });
