// Lot 8 (ticket Data analyst du 24/10) : salon à 4 sur un faux direct type TF1, retards différents (6, 9, 12 et 22 s).
// Octave arrive en retard dans un salon déjà en direct (P1). On vérifie : tout le monde se cale, peu de calages
// (pas de ping-pong, P3), le mode reste « direct », et les statistiques de séance sont justes pour 4 personnes.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'), http = require('http');
const BASE = 'http://localhost:8080', LIVE = 'http://localhost:8095';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { live } = require('../testlive/livesrv.js');
const got = [];
http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { got.push(JSON.parse(b)); } catch {} res.end('{}'); }); }).listen(8097);

(async () => {
  await sleep(20000); // assez de morceaux de direct pour que chacun prenne son retard
  const errs = [];
  async function person(dir, who, lat, name) {
    const c = await chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
      `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    const sw = c.serviceWorkers()[0] || await c.waitForEvent('serviceworker');
    const v = await c.newPage(); v.on('pageerror', e => errs.push(who + ' page ' + e.message));
    await v.goto(`${LIVE}/player.html?who=${who}&lat=${lat}`);
    await v.waitForFunction(() => window.__truth && window.__truth(), null, { timeout: 30000 });
    const tab = await sw.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u)).id, 'who=' + who);
    const p = await c.newPage(); p.on('pageerror', e => errs.push(who + ' ' + e.message));
    await p.goto(`chrome-extension://${new URL(sw.url()).host}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
    await p.fill('#name', name); await p.click('#consentYes').catch(() => {});
    await v.bringToFront();
    return { c, v, p, name };
  }
  const truth = x => x.v.evaluate(() => window.__truth());
  const spread = async xs => { const t = await Promise.all(xs.map(truth)); return Math.max(...t) - Math.min(...t); };
  const until = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return (Date.now() - t0) / 1000; await sleep(1000); } return null; };

  const A = await person('/tmp/claude-0/q4a', 'lucas', 6, 'Lucas'), B = await person('/tmp/claude-0/q4b', 'agathe', 9, 'Agathe'), C = await person('/tmp/claude-0/q4c', 'cecile', 12, 'Cécile');
  await A.p.click('#create'); await A.p.click('#go'); await A.p.waitForSelector('#room:not(.hidden)', { timeout: 15000 });
  const code = await A.p.textContent('#code');
  for (const X of [B, C]) { await X.p.fill('#codeIn', code); await X.p.click('#joinBtn'); await X.p.waitForSelector('#room:not(.hidden)', { timeout: 15000 }); }
  const s0 = (await (await fetch(BASE + '/stats')).json()).totals.autoSyncs;
  const t3 = await until(async () => (await spread([A, B, C])) < 400, 40000);
  ok(t3 != null, `à 3 : tout le monde calé (écart ${Math.round(await spread([A, B, C]))} ms, en ${t3 ?? '—'} s)`);

  // Octave arrive en retard (22 s de retard) dans un salon déjà en direct
  const D = await person('/tmp/claude-0/q4d', 'octave', 22, 'Octave');
  const before = await spread([A, B, C, D]);
  ok(before > 3000, `Octave arrive avec ${(before / 1000).toFixed(1)} s d'écart sur les autres`);
  await D.p.fill('#codeIn', code); await D.p.click('#joinBtn'); await D.p.waitForSelector('#room:not(.hidden)', { timeout: 15000 });
  const t4 = await until(async () => (await spread([A, B, C, D])) < 400, 40000);
  ok(t4 != null, `arrivée dans un salon déjà en direct : les 4 calés en ${t4 ?? '—'} s (écart ${Math.round(await spread([A, B, C, D]))} ms)`);
  await sleep(15000);
  const sp = await spread([A, B, C, D]);
  ok(sp < 500, `15 s plus tard : toujours calés à 4 (${Math.round(sp)} ms)`);
  const st = await (await fetch(BASE + '/stats')).json();
  ok(st.totals.autoSyncs - s0 <= 4, `pas de ping-pong : ${st.totals.autoSyncs - s0} calages pour 2 arrivées`);
  const paused = await Promise.all([A, B, C, D].map(x => x.v.evaluate(() => document.querySelector('video').paused)));
  ok(paused.every(p => !p), 'les 4 vidéos tournent');
  ok(/Calé automatiquement/.test(await D.p.textContent('#autoState')), `panneau d'Octave : « ${await D.p.textContent('#autoState')} »`);
  ok((await A.p.$$('.peer')).length === 4, 'le groupe affiche 4 personnes');

  // Fin de séance : statistiques pour 4
  for (const X of [A, B, C, D]) { await X.p.click('#menuBtn'); await X.p.click('#leave'); }
  const tg = await until(async () => got.length > 0, 20000);
  const d = got[0] || {}, s = d.session || {};
  ok(tg != null && s.participants === 4 && s.avec_video === 4 && s.accords === 4, `statistiques : 4 participants, 4 vidéos, 4 accords (${s.participants}, ${s.avec_video}, ${s.accords})`);
  ok(/^[0-9a-f]{12}$/.test(s.createur || '') && s.duree_a_plusieurs_s > 20, `créateur ${s.createur}, ${s.duree_a_plusieurs_s} s à plusieurs`);
  ok((d.evenements || []).filter(e => e.type === 'mode').every(e => e.qui !== undefined) && (d.evenements || []).some(e => e.type === 'calage'), 'événements de mode et de calage présents');
  ok((d.participants || []).every(p => p.site === 'localhost'), 'le site est rempli pour chacun');
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  for (const X of [A, B, C, D]) await X.c.close();
  live.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
