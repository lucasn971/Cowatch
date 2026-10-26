// 0.9.3 — ambiances Anime (Simulcast jade, ex-« Manga ») et Paddock (planche Design du 26/10).
// Anime : /spoil flouté (panneau + vidéo), PEAK quand tout le monde réagit en même temps.
// Paddock : feux de départ vus par tous, drapeaux en bandeau, celui qui parle en « RADIO ».
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
  const cA = await mk('/tmp/claude-0/apa'), cB = await mk('/tmp/claude-0/apb');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const errs = [];
  async function open(c, who, name) {
    const s = await sw(c), id = new URL(s.url()).host;
    const v = await c.newPage(); v.on('pageerror', e => errs.push(name + ' page ' + e.message));
    await v.setViewportSize({ width: 1280, height: 720 });
    await v.goto(`${BASE}/test-player.html?who=${who}`);
    await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
    const tab = await s.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u)).id, 'who=' + who);
    const p = await c.newPage(); p.on('pageerror', e => errs.push(name + ' ' + e.message));
    await p.setViewportSize({ width: 320, height: 860 });
    await p.goto(`chrome-extension://${id}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
    await p.fill('#name', name); return { s, v, p };
  }
  const A = await open(cA, 'aa', 'Aya'), B = await open(cB, 'bb', 'Bao');
  const react = (X, em) => X.p.click(`#react button:text-is("${em}")`);

  // --- Écran de choix : 7 ambiances, toutes sélectionnables ---
  await A.p.click('#create');
  const ids = await A.p.$$eval('.card', c => c.map(x => x.dataset.id + (x.getAttribute('aria-disabled') === 'true' ? '!' : '')));
  ok(ids.join(',') === 'vestiaire,salle,canape,live,arene,anime,paddock', 'écran de choix : 7 ambiances, toutes disponibles (' + ids.join(',') + ')');
  ok((await A.p.textContent('.card[data-id="anime"] b')) === 'Anime', 'la carte s\'appelle « Anime » (plus « Manga »)');
  await A.p.screenshot({ path: `${SHOTS}/choix-7.png` });

  // --- Anime ---
  await A.p.click('.card[data-id="anime"]'); await A.p.click('#go'); await A.p.waitForSelector('#room:not(.hidden)');
  const code = await A.p.textContent('#code');
  await B.p.fill('#codeIn', code); await B.p.click('#joinBtn'); await B.p.waitForSelector('#room:not(.hidden)');
  ok(await until(() => B.p.evaluate(() => document.documentElement.dataset.theme === 'anime')), 'Bao arrive en Anime');
  ok((await A.p.textContent('#logo')) === 'cowatch.', 'logo « cowatch. » avec le point jade');
  ok((await A.p.$$eval('#react button', b => b.map(x => x.textContent).join(''))) === '😭🔥💀🙏⚡😳', 'émojis Anime 😭🔥💀🙏⚡😳');
  ok((await A.p.getAttribute('#chatIn', 'placeholder')).includes('/spoil'), 'le champ rappelle « /spoil pour flouter »');
  ok(await A.p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cw-accent').trim().toUpperCase() === '#19D3A6'), 'accent jade #19D3A6');
  await until(() => B.v.evaluate(() => !!document.querySelector('#cowatch-bar, #cowatch-react') || true));

  await A.p.fill('#chatIn', '/spoil il revient à la fin'); await A.p.press('#chatIn', 'Enter');
  ok(await until(() => B.p.evaluate(() => { const s = [...document.querySelectorAll('#chat .spoil')].pop(); return s && s.textContent === 'il revient à la fin' && getComputedStyle(s).filter.includes('blur'); })), 'spoil : flouté dans le panneau de Bao, sans le « /spoil »');
  ok(await B.p.evaluate(() => !![...document.querySelectorAll('#chat .spoil-tag')].length), 'pastille ambre « spoil »');
  await B.p.click('#chat .spoil');
  ok(await until(() => B.p.evaluate(() => getComputedStyle(document.querySelector('#chat .spoil')).filter === 'none'), 2000), 'un clic le dévoile');
  ok(await until(() => B.v.evaluate(() => { const c = document.querySelector('#cowatch-chat'); if (!c) return false; const sp = [...c.querySelectorAll('span')].find(s => s.textContent === 'il revient à la fin'); return sp && sp.style.filter.includes('blur') && c.innerText.includes('SPOIL'); })), 'spoil flouté aussi sur la vidéo');
  await A.p.screenshot({ path: `${SHOTS}/anime-panneau.png` });

  await react(A, '🔥'); await react(B, '🔥');
  ok(await until(() => B.v.evaluate(() => (document.querySelector('#cowatch-peak')?.innerText || '').includes('PEAK')), 4000), 'PEAK quand tout le monde réagit en même temps');
  await sleep(250); await B.v.screenshot({ path: `${SHOTS}/anime-peak.png` });
  await sleep(1800);
  ok(await B.v.evaluate(() => !(document.querySelector('#cowatch-peak')?.innerText)), 'PEAK ne reste pas affiché (une fois)');
  await react(A, '😭'); await react(B, '😭');
  await sleep(600);
  ok(await B.v.evaluate(() => !(document.querySelector('#cowatch-peak')?.innerText)), 'pas de second PEAK juste après (30 s minimum)');

  // --- Paddock ---
  await A.p.click('#menuBtn'); await A.p.click('#mTheme'); await A.p.click('.card[data-id="paddock"]'); await A.p.click('#go');
  ok(await until(() => B.p.evaluate(() => document.documentElement.dataset.theme === 'paddock')), 'Paddock chez tout le monde');
  ok((await A.p.textContent('#logo')) === 'Cowatch/', 'logo « Cowatch/ » à barre jaune');
  ok((await A.p.$$eval('#react button', b => b.map(x => x.textContent).join(''))) === '🏎️🔥😱🟡🏁🍾', 'émojis Paddock 🏎️🔥😱🟡🏁🍾');
  ok(await until(async () => (await B.p.textContent('#invite')) === 'Inviter au paddock' && (await B.p.getAttribute('#chatIn', 'placeholder')) === 'Message radio…'), 'textes Paddock (« Inviter au paddock », « Message radio… »)');
  ok(await B.p.isVisible('#lightsBtn'), 'bouton « Feux de départ » visible (Paddock seulement)');
  await sleep(500); await A.p.screenshot({ path: `${SHOTS}/paddock-panneau.png` });

  await B.p.click('#lightsBtn');
  ok(await until(() => A.v.evaluate(() => document.querySelectorAll('#cowatch-lights span').length === 5), 4000), 'feux de départ : 5 feux sur la vidéo d\'Aya');
  ok(await until(() => B.v.evaluate(() => document.querySelectorAll('#cowatch-lights span').length === 5), 4000), '… et sur celle de Bao');
  await sleep(3200); await A.v.screenshot({ path: `${SHOTS}/paddock-feux.png` });
  ok(await until(() => A.v.evaluate(() => { const g = document.querySelector('#cowatch-lights div:last-child'); return g && g.textContent === 'Extinction des feux !' && getComputedStyle(g).opacity === '1'; }), 4000), '« Extinction des feux ! » quand les feux s\'éteignent');
  await sleep(300); await A.v.screenshot({ path: `${SHOTS}/paddock-extinction.png` });
  ok((await A.p.textContent('#chat')).includes('lance les feux de départ'), 'pastille dans le chat : « Bao lance les feux de départ »');
  ok(await B.p.isDisabled('#lightsBtn'), 'le bouton se repose 15 s (pas de feux en boucle)');
  ok(await until(() => A.v.evaluate(() => !document.querySelector('#cowatch-lights')?.childElementCount), 4000), 'les feux disparaissent ensuite');

  await react(A, '🏁');
  ok(await until(() => B.v.evaluate(() => (document.querySelector('#cowatch-flag')?.innerText || '').toLowerCase().includes('damier')), 4000), '🏁 : bandeau « Drapeau à damier » en haut de la vidéo');
  await sleep(400); await B.v.screenshot({ path: `${SHOTS}/paddock-damier.png` });
  await react(B, '🟡');
  ok(await until(() => A.v.evaluate(() => (document.querySelector('#cowatch-flag')?.innerText || '').toLowerCase().includes('jaune')), 4000), '🟡 : bandeau « Drapeau jaune »');

  // celui qui parle : message radio (la fausse voix du test parle en boucle)
  ok(await until(() => B.v.evaluate(() => (document.querySelector('#cowatch-faces')?.innerText || '').includes('RADIO')), 20000), 'celui qui parle apparaît en « RADIO » avec son onde');
  await B.v.screenshot({ path: `${SHOTS}/paddock-radio.png` });

  // un ancien salon resté sur « manga » ne casse rien
  ok(await A.p.evaluate(() => self.CowatchThemes.get('manga').name === 'Vestiaire'), 'ancien identifiant « manga » : retour au Vestiaire, sans erreur');

  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await cA.close(); await cB.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
