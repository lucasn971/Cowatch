// Test de fiabilité (retours du test réel du 20/10) :
//  1. serveur qui se réveille lentement (Render gratuit) + clics répétés sur « Créer un salon » => un seul salon, une seule présence ;
//  2. chaque message n'apparaît qu'une fois ;
//  3. l'invité qui a cliqué « Créer », puis « Quitter », puis colle le lien peut quand même écrire et parler.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const net = require('net');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Faux « serveur endormi » : sur le port 8081, chaque connexion attend que le serveur soit « réveillé » (8 s) avant de passer.
// Les 3 premières secondes, il refuse carrément les connexions (comme Render pendant son démarrage).
let wakeAt = 0, refuseUntil = 0; const live = new Set();
const SLOW = 'http://localhost:8081';
const dropAll = () => live.forEach(s => s.destroy()); // coupure réseau
net.createServer(client => {
  client.on('error', () => {});
  if (Date.now() < refuseUntil) return client.destroy();
  live.add(client); client.on('close', () => live.delete(client));
  const wait = Math.max(0, wakeAt - Date.now()); const chunks = []; client.on('data', d => chunks.push(d));
  setTimeout(() => {
    const up = net.connect(8080, 'localhost', () => { client.removeAllListeners('data'); chunks.forEach(c => up.write(c)); client.pipe(up); up.pipe(client); });
    up.on('error', () => client.destroy()); client.on('close', () => up.destroy());
  }, wait);
}).listen(8081);

(async () => {
  const mk = dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const cA = await mk('/tmp/claude-0/fia'), cB = await mk('/tmp/claude-0/fib');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const extId = async c => new URL((await sw(c)).url()).host;
  const tabIdOf = async (c, u) => (await sw(c)).evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u))?.id, u);
  const errs = [];
  const panel = async (c, who, server) => {
    const v = await c.newPage(); await v.goto(BASE + '/test-player.html?who=' + who);
    await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
    const p = await c.newPage(); p.on('pageerror', e => errs.push(who + ' ' + e.message));
    await p.goto(`chrome-extension://${await extId(c)}/panel.html?tab=${await tabIdOf(c, 'who=' + who)}&server=${encodeURIComponent(server)}`);
    await sleep(800); return p;
  };

  // --- 1. Lucas : serveur endormi, il clique 3 fois sur « Créer un salon » ---
  const pA = await panel(cA, 'lucas', SLOW);
  await pA.fill('#name', 'Lucas');
  wakeAt = Date.now() + 8000; refuseUntil = Date.now() + 3000;
  await pA.click('#create'); await pA.click('#go'); await sleep(250);
  const busy = await pA.evaluate(() => ({ dis: document.querySelector('#go').disabled, txt: document.querySelector('#go').textContent }));
  ok(busy.dis || /connexion|réveil/i.test(busy.txt), `retour immédiat après le clic (« ${busy.txt} »)`);
  await pA.click('#go', { force: true }).catch(() => {}); await sleep(1500);
  await pA.click('#go', { force: true }).catch(() => {});
  await pA.waitForSelector('#room:not(.hidden)', { timeout: 30000 });
  await sleep(3000);
  const code = await pA.textContent('#code');
  const meA = await pA.$$eval('.peer', els => els.map(e => e.textContent));
  ok(meA.length === 1, `un seul Lucas dans le salon malgré 3 clics (${meA.join(', ')})`);
  const stats = await (await fetch(BASE + '/stats')).json();
  ok(stats.rooms === 1 && stats.clients === 2, `côté serveur : 1 salon, 1 présence + 1 lecteur (${stats.rooms} salon(s), ${stats.clients} connexion(s))`);

  // --- 2. Kylian : clique « Créer », « Quitter », puis colle le lien de Lucas ---
  const pB = await panel(cB, 'kylian', SLOW);
  await pB.fill('#name', 'Kylian');
  await pB.click('#create'); await pB.click('#go'); await pB.waitForSelector('#room:not(.hidden)', { timeout: 15000 });
  await pB.click('#menuBtn'); await pB.click('#leave'); await pB.waitForSelector('#home:not(.hidden)'); await sleep(800);
  await pB.fill('#codeIn', `${BASE}/j/${code}?u=x`); await pB.click('#joinBtn');
  await pB.waitForFunction(c => document.querySelector('#code')?.textContent === c && !document.querySelector('#room').classList.contains('hidden'), code, { timeout: 15000 });
  await sleep(4000);

  // --- 3. Chat dans les deux sens, une seule fois chacun ---
  await pA.fill('#chatIn', 'Salut Kiki'); await pA.press('#chatIn', 'Enter');
  await pB.fill('#chatIn', 'Salut Lucas'); await pB.press('#chatIn', 'Enter');
  await sleep(1200);
  const count = async (p, s) => p.$$eval('#chat .msg', (els, s) => els.filter(e => e.textContent.includes(s)).length, s);
  ok(await count(pA, 'Salut Kiki') === 1, `message de Lucas affiché une seule fois chez lui (${await count(pA, 'Salut Kiki')})`);
  ok(await count(pB, 'Salut Kiki') === 1, `message de Lucas reçu une fois par Kylian (${await count(pB, 'Salut Kiki')})`);
  ok(await count(pA, 'Salut Lucas') === 1, `message de Kylian reçu par Lucas (${await count(pA, 'Salut Lucas')})`);

  // --- 4. Voix dans les deux sens ---
  const stB = await pB.evaluate(() => chrome.runtime.sendMessage({ to: 'engine', cmd: 'stats' }));
  const stA = await pA.evaluate(() => chrome.runtime.sendMessage({ to: 'engine', cmd: 'stats' }));
  ok(stB.mic && stB.audio >= 1, `Kylian a son micro et entend Lucas (${JSON.stringify(stB)})`);
  ok(stA.audio >= 1, `Lucas entend Kylian (${JSON.stringify(stA)})`);
  let finalStats = await (await fetch(BASE + '/stats')).json();
  ok(finalStats.clients === 4, `côté serveur : exactement 4 connexions (2 présences + 2 lecteurs) : ${finalStats.clients}`);

  // --- 5. Coupure réseau pour les deux : reconnexion sans fantôme ni message en double ---
  dropAll(); await sleep(9000);
  finalStats = await (await fetch(BASE + '/stats')).json();
  ok(finalStats.clients === 4, `après coupure : toujours 4 connexions, aucun fantôme (${finalStats.clients})`);
  const names = await pB.$$eval('.peer', els => els.map(e => e.textContent));
  ok(names.length === 2 && !names.some(n => /Lucas 2|Kylian 2/.test(n)), `après coupure : 2 personnes affichées (${names.join(', ')})`);
  ok(await count(pB, 'Salut Kiki') === 1, `après coupure : l'historique n'est pas affiché en double (${await count(pB, 'Salut Kiki')})`);
  await pB.fill('#chatIn', 'Toujours là ?'); await pB.press('#chatIn', 'Enter'); await sleep(800);
  ok(await count(pA, 'Toujours là ?') === 1, 'après coupure : le chat repart');
  await sleep(3000);
  const s2 = await pA.evaluate(() => chrome.runtime.sendMessage({ to: 'engine', cmd: 'stats' }));
  ok(s2.audio >= 1, `après coupure : la voix repart (${JSON.stringify(s2)})`);
  ok(!(await pB.textContent('#chat')).includes('est parti'), 'après coupure : pas de « est parti / est arrivé » parasites');

  // --- 6. Direct sans heure réelle (comme TF1) : le panneau le dit et propose le TOP ---
  for (const c of [cA, cB]) for (const pg of c.pages()) if (pg.url().includes('test-player')) await pg.evaluate(() => { const v = document.querySelector('video'); v.dataset.cowatchLive = '1'; });
  await sleep(5000);
  const auto = await pB.textContent('#autoState');
  ok(/indisponible/.test(auto) && await pB.evaluate(() => document.querySelector('#manual').open), `direct type TF1 : « ${auto} » et calage manuel ouvert`);
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await pA.screenshot({ path: '/tmp/claude-0/fia.png' }); await pB.screenshot({ path: '/tmp/claude-0/fib.png' });
  await cA.close(); await cB.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
