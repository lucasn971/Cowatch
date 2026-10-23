// Essai réel du 23/10 : le panneau latéral de Chrome est commun à tous les onglets.
//  1. Panneau ouvert sur un onglet sans vidéo, salon créé, puis on va sur l'onglet vidéo : le salon suit l'onglet vidéo.
//  2. Invitation cliquée alors qu'on est déjà dans un autre salon : le panneau propose de la rejoindre (avant : rien ne se passait).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await sleep(150); } return false; };

(async () => {
  const c = await chromium.launchPersistentContext('/tmp/claude-0/ong', { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const sw = c.serviceWorkers()[0] || await c.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const tabOf = u => sw.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u))?.id, u);
  const errs = [];
  const blank = await c.newPage(); await blank.goto(BASE + '/'); // onglet sans vidéo (comme chrome://extensions)
  const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(`chrome-extension://${extId}/panel.html?tab=${await tabOf(BASE + '/')}&follow=1&server=${encodeURIComponent(BASE)}`);
  await p.fill('#name', 'Lucas'); await p.click('#create'); await p.click('#go');
  await p.waitForSelector('#room:not(.hidden)', { timeout: 15000 }); await sleep(1000);
  ok(/Aucune/.test(await p.textContent('#playerStatus')), 'salon créé sur un onglet sans vidéo : « Aucune vidéo détectée »');

  // On ouvre la vidéo dans un autre onglet et on l'affiche.
  const v = await c.newPage(); await v.goto(BASE + '/test-player.html?who=ong');
  await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
  await v.bringToFront(); await sleep(2500);
  ok(/détectée ✓/.test(await p.textContent('#playerStatus')), `le panneau suit l'onglet vidéo (« ${await p.textContent('#playerStatus')} »)`);
  ok(/test|Cowatch|lecteur/i.test(await p.textContent('#nowTitle')) || (await p.textContent('#nowTitle')) !== '', `titre du programme mis à jour (« ${await p.textContent('#nowTitle')} »)`);
  const linked = await v.evaluate(() => new Promise(r => { let n = 0; const t = setInterval(() => { if (document.getElementById('cowatch-banner') || ++n > 20) { clearInterval(t); r(!!document.getElementById('cowatch-banner')); } }, 200); }));
  ok(linked, 'la vidéo est reliée au salon (bandeau « Salon connecté »)');
  ok(await until(async () => !(await v.evaluate(() => !!document.getElementById('cowatch-reopen'))), 3000), 'panneau ouvert sur la vidéo suivie : pas de languette « rouvrir »');

  // Retour sur l'onglet sans vidéo : le salon reste sur la vidéo.
  await blank.bringToFront(); await sleep(1500);
  ok(/détectée ✓/.test(await p.textContent('#playerStatus')), 'retour sur un onglet sans vidéo : le salon reste sur la vidéo');

  // Invitation vers un autre salon pendant qu'on est en salon.
  const code1 = await p.textContent('#code');
  await p.evaluate(() => chrome.storage.local.set({ pendingJoin: { code: 'AUTRE', at: Date.now() } }));
  await sleep(600);
  ok(await p.isVisible('#invBar') && (await p.textContent('#invCode')) === 'AUTRE', 'invitation reçue en salon : le panneau propose « Rejoindre AUTRE »');
  ok((await p.textContent('#code')) === code1, 'sans clic, on reste dans son salon');
  await p.click('#invGo');
  await p.waitForFunction(() => document.querySelector('#code').textContent === 'AUTRE', null, { timeout: 15000 }).catch(() => {});
  ok((await p.textContent('#code')) === 'AUTRE' && !(await p.isVisible('#invBar')), 'un clic : on change de salon');
  await sleep(1500);
  ok(/détectée ✓/.test(await p.textContent('#playerStatus')), 'après changement de salon, la vidéo reste reliée');
  // Nouvel utilisateur arrivé par une invitation (pas encore de pseudo) : le bouton principal rejoint, il ne crée pas.
  await p.click('#menuBtn'); await p.click('#leave'); await p.waitForSelector('#home:not(.hidden)');
  await p.fill('#name', '');
  await p.evaluate(() => chrome.storage.local.set({ pendingJoin: { code: 'INVIT', at: Date.now() } })); await sleep(600);
  ok((await p.textContent('#create')) === 'Rejoindre le salon INVIT', `invitation sans pseudo : le gros bouton dit « ${await p.textContent('#create')} »`);
  await p.fill('#name', 'Octave'); await p.click('#create');
  ok(await until(async () => (await p.textContent('#code')) === 'INVIT' && await p.isVisible('#room'), 10000), 'pseudo tapé + gros bouton : on entre dans le salon de l\'invitation (pas de salon à côté)');
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await c.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
