// Test 0.7 : calage automatique du direct à chaque arrivée + plein écran qui range le panneau sans couper la voix.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const mk = dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + path.resolve(__dirname, 'voice.wav')] });
  const errs = [];
  async function person(dir, who, name, ahead) {
    const c = await mk(dir);
    const sw = c.serviceWorkers()[0] || await c.waitForEvent('serviceworker'), id = new URL(sw.url()).host;
    const v = await c.newPage(); await v.goto(`${BASE}/test-player.html?who=${who}`);
    await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
    // « Direct » simulé : position = heure de l'image ; « ahead » = secondes d'avance sur le direct des autres
    // position = heure réelle de l'image ; chaque participant a 20 s de retard sur le réel, moins son « avance »
    await v.evaluate(a => { const vid = document.querySelector('video'); vid.dataset.cowatchLive = '1'; vid.muted = true; vid.currentTime = 5;
      vid.dataset.cowatchEpoch = String(Date.now() / 1000 - 20 + a - 5); vid.play(); }, ahead);
    const tab = await sw.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u)).id, 'who=' + who);
    const p = await c.newPage(); p.on('pageerror', e => errs.push(name + ' ' + e.message));
    await p.goto(`chrome-extension://${id}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
    await p.fill('#name', name);
    return { c, v, p, sw };
  }
  const paused = x => x.v.evaluate(() => document.querySelector('video').paused);
  // Lucas a 5 s d'avance sur Kilian (au-delà de 3 s : pause)
  const A = await person('/tmp/claude-0/sa', 'lucas', 'Lucas', 5);
  await A.p.click('#create'); await A.p.click('#go'); await A.p.waitForSelector('#room:not(.hidden)');
  const code = await A.p.textContent('#code');
  const B = await person('/tmp/claude-0/sb', 'kilian', 'Kilian', 0);
  await B.p.fill('#codeIn', code); await B.p.click('#joinBtn'); await B.p.waitForSelector('#room:not(.hidden)');
  ok(await A.p.isVisible('#calib'), 'direct détecté tout seul : mode match');
  // Kilian arrive : Lucas (en avance) doit se mettre en pause ~5 s, sans TOP
  let pausedA = false;
  for (let i = 0; i < 40 && !pausedA; i++) { pausedA = await paused(A); if (!pausedA) await sleep(250); }
  ok(pausedA && !(await paused(B)), 'arrivée de Kilian : Lucas (5 s d\'avance) mis en pause automatiquement, Kilian continue');
  await sleep(5800);
  ok(!(await paused(A)), 'Lucas reprend tout seul après ~5 s');
  ok((await A.p.textContent('#autoState')).includes('Calé automatiquement'), `panneau : ${await A.p.textContent('#autoState')}`);
  ok((await B.p.textContent('#chat')).includes('Kilian est arrivé : salon recalé'), 'message dans le chat : salon recalé à l\'arrivée');
  // Nora arrive avec 2 s de retard sur tout le monde : petit écart => Lucas ET Kilian ralentissent (0,75×) sans figer l'image
  await sleep(1500);
  const C = await person('/tmp/claude-0/sc', 'nora', 'Nora', -2);
  await C.p.fill('#codeIn', code); await C.p.click('#joinBtn'); await C.p.waitForSelector('#room:not(.hidden)');
  const rate = x => x.v.evaluate(() => document.querySelector('video').playbackRate);
  let both = false;
  for (let i = 0; i < 40 && !both; i++) { both = (await rate(A)) < 1 && (await rate(B)) < 1; if (!both) await sleep(200); }
  ok(both && !(await paused(A)) && !(await paused(B)) && (await rate(C)) === 1, 'arrivée de Nora (2 s de retard) : Lucas et Kilian ralentissent légèrement, sans pause');
  await sleep(12000);
  ok((await rate(A)) === 1 && (await rate(B)) === 1 && !(await paused(A)) && !(await paused(B)), 'tout le monde revient à vitesse normale : salon calé');

  // (plein écran : voir plein-ecran.js)
  ok(errs.length === 0, 'aucune erreur JS' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await A.c.close(); await B.c.close(); await C.c.close();
})().catch(e => { console.error(e); process.exit(1); });
