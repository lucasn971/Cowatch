// Calage automatique sur un direct « type TF1 » : HLS, lecteur hls.js, temps vidéo qui ne donne PAS l'heure réelle.
// Le faux direct (port 8095) publie un morceau de 2 s toutes les 2 s avec son heure réelle (PROGRAM-DATE-TIME).
// Lucas regarde avec 6 s de retard, Kilian avec 14 s : Cowatch doit le mesurer seul et caler Lucas sur Kilian.
// Vérité terrain : hls.playingDate (heure réelle de l'image affichée, calculée par hls.js lui-même).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080', LIVE = 'http://localhost:8095';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Scénario « snap » : le lecteur de Lucas refuse d'avoir plus de 9 s de retard (il revient tout seul au direct).
// Cowatch doit le comprendre et faire avancer Kilian jusqu'à Lucas.
const SNAP = process.argv.includes('snap');
// Scénario « dash » : même chose avec un direct DASH lu par dash.js (format de Prime Video, M6+, france.tv).
const DASH = process.argv.includes('dash');

const { live } = require('../testlive/livesrv.js');

(async () => {
  const mk = dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const cA = await mk('/tmp/claude-0/la'), cB = await mk('/tmp/claude-0/lb');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const extId = async c => new URL((await sw(c)).url()).host;
  const tabIdOf = async (c, u) => (await sw(c)).evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u))?.id, u);
  const errs = [];
  await sleep(20000); // assez de morceaux pour que chacun prenne son retard
  const open = async (c, who, lat) => {
    const v = await c.newPage(); v.on('pageerror', e => errs.push(who + ' page ' + e.message));
    await v.goto(`${LIVE}/${DASH ? 'player-dash' : 'player'}.html?who=${who}&lat=${lat}` + (who === 'lucas' && SNAP ? '&max=9' : ''));
    await v.waitForFunction(() => window.__truth && window.__truth(), null, { timeout: 30000 });
    const p = await c.newPage(); p.on('pageerror', e => errs.push(who + ' ' + e.message));
    await p.goto(`chrome-extension://${await extId(c)}/panel.html?tab=${await tabIdOf(c, 'who=' + who)}&server=${encodeURIComponent(BASE)}`);
    await v.bringToFront(); await sleep(800); return { v, p };
  };
  // Heure réelle vue par Cowatch (même calcul que player.js) et vérité terrain, sur la même image.
  const measure = v => v.evaluate(() => {
    const vid = document.querySelector('video'), t = vid.currentTime, map = JSON.parse(vid.getAttribute('data-cowatch-map') || 'null');
    if (!map) return { truth: window.__truth(), cw: null };
    let best = map[0]; for (const s of map) if (s.m <= t + 0.05) best = s;
    return { truth: window.__truth(), cw: t * 1000 + best.off, n: map.length, t };
  });

  const A = await open(cA, 'lucas', SNAP ? 4 : 6), B = await open(cB, 'kilian', 14);
  if (SNAP) console.log('--- scénario : le lecteur de Lucas revient tout seul au direct');
  if (DASH) console.log('--- scénario : direct DASH (dash.js)');
  await sleep(6000);
  for (const [who, x] of [['Lucas', A], ['Kilian', B]]) {
    const m = await measure(x.v);
    ok(m.cw != null && Math.abs(m.cw - m.truth) < 80, `${who} : heure réelle de l'image retrouvée seule, écart avec la vérité ${m.cw == null ? '—' : Math.round(m.cw - m.truth) + ' ms'} (${m.n || 0} repères)`);
  }
  const gap0 = (await measure(A.v)).truth - (await measure(B.v)).truth;
  ok(gap0 > 6000, `avant calage : Lucas a ${(gap0 / 1000).toFixed(1)} s d'avance sur Kilian`);

  // Salon : Lucas crée, Kilian rejoint ; le calage doit se faire tout seul.
  await A.p.fill('#name', 'Lucas'); await A.p.click('#create'); await A.p.click('#go'); await A.p.waitForSelector('#room:not(.hidden)', { timeout: 15000 });
  const code = await A.p.textContent('#code');
  await B.p.fill('#name', 'Kilian'); await B.p.fill('#codeIn', code); await B.p.click('#joinBtn');
  await B.p.waitForSelector('#room:not(.hidden)', { timeout: 15000 });
  const t0 = Date.now(); let gap = gap0;
  while (Date.now() - t0 < (SNAP ? 70000 : 25000)) { await sleep(1000); gap = (await measure(A.v)).truth - (await measure(B.v)).truth; if (Math.abs(gap) < 300 && Date.now() - t0 > (SNAP ? 30000 : 3000)) break; }
  ok(Math.abs(gap) < 300, `après calage automatique : écart ${Math.round(gap)} ms (en ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await sleep(8000);
  const gap2 = (await measure(A.v)).truth - (await measure(B.v)).truth;
  ok(Math.abs(gap2) < 300, `8 s plus tard : toujours calés (${Math.round(gap2)} ms)`);
  ok(!(await A.v.evaluate(() => document.querySelector('video').paused)) && !(await B.v.evaluate(() => document.querySelector('video').paused)), 'les deux vidéos tournent');
  const st = await B.p.textContent('#autoState');
  ok(/Calé automatiquement/.test(st), `panneau de Kilian : « ${st} »`);
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  if (SNAP) { const s = await (await fetch(BASE + '/stats')).json(); ok(s.totals.noBack >= 1, `le serveur a repéré le lecteur qui revient au direct (${s.totals.noBack || 0})`); }
  await cA.close(); await cB.close(); live.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
