// Test du bouton Diagnostic (lecture seule) + détection d'une vidéo cachée dans un shadow DOM.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const c = await chromium.launchPersistentContext('/tmp/claude-0/diag', { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const sw = c.serviceWorkers()[0] || await c.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host, errs = [];
  // Page dont la vidéo est déplacée dans un shadow DOM (comme certains lecteurs).
  const v = await c.newPage(); await v.goto(BASE + '/test-player.html?who=shadow');
  await v.evaluate(() => { const vid = document.querySelector('video'); const host = document.createElement('div'); document.body.append(host); host.attachShadow({ mode: 'open' }).append(vid); vid.muted = true; vid.play(); });
  const tab = await sw.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url.includes('who=shadow')).id);
  const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(`chrome-extension://${id}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
  await sleep(2000);
  ok((await p.textContent('#playerStatus')).includes('détectée ✓'), 'vidéo trouvée même cachée dans un shadow DOM');
  await p.fill('#name', 'Lucas'); await p.click('#create'); await p.click('#go'); await p.waitForSelector('#room:not(.hidden)');
  await p.click('#menuBtn'); await p.click('#diag'); await sleep(4500);
  const txt = await p.inputValue('#diagOut');
  ok(txt.startsWith('DIAGNOSTIC COWATCH'), 'le diagnostic produit un rapport');
  let r = null; try { r = JSON.parse(txt.split('\n').slice(1).join('\n')); } catch {}
  const f = r && r.frames.find(x => x.top);
  ok(f && f.videos === 1 && f.inShadow === 1 && f.picked === 'oui', 'rapport : 1 vidéo, dans un shadow DOM, sélectionnée');
  ok(f && f.sampleA && f.sampleB && typeof f.sampleB.currentTime === 'number' && Array.isArray(f.sampleB.seekable), 'rapport : deux relevés du lecteur (position, plage disponible)');
  ok(f && Math.abs(f.advance - 1) < 0.2, `rapport : vitesse de lecture mesurée (${f && f.advance})`);
  ok(!/@|password|cookie/i.test(txt), 'rapport : aucune donnée personnelle');
  ok(errs.length === 0, 'aucune erreur dans le panneau' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await c.close();
})();
