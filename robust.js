// Back-test du salon web : cas difficiles (4 personnes, pseudos en double, coupure serveur, départ/retour, test micro).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 8090, BASE = `http://localhost:${PORT}`;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let srv;
const startServer = () => new Promise(r => { srv = spawn('node', [path.resolve(__dirname, '../server/server.js')], { env: { ...process.env, PORT } }); srv.stdout.once('data', () => r()); });

(async () => {
  await startServer();
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const open = async (name, room = 'ROBUST') => {
    const p = await (await b.newContext()).newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message));
    await p.goto(`${BASE}/s/${room}`); await p.fill('#name', name); await p.click('#go'); await p.waitForSelector('#in:not(.hidden)'); return p;
  };
  const states = p => p.$$eval('.peer .s', e => e.map(x => x.textContent));
  const online = async p => (await states(p)).filter(s => s === 'en ligne').length;

  // 1. Test du micro avant d'entrer
  const t = await (await b.newContext()).newPage(); await t.goto(BASE + '/');
  await t.click('#micTest');
  let peak = 0; for (let i = 0; i < 30; i++) { await sleep(100); peak = Math.max(peak, await t.$eval('#meter', e => parseFloat(e.style.width) || 0)); }
  ok(await t.isVisible('#meterBox') && peak > 0, `test du micro : la barre de niveau bouge avant d'entrer (pic ${Math.round(peak)} %)`);
  await t.close();

  // 2. Quatre personnes : chacun connecté aux trois autres
  const P = []; for (const n of ['Lucas', 'Kylian', 'Nora', 'Sam']) { P.push(await open(n)); await sleep(400); }
  await sleep(5000);
  const counts = await Promise.all(P.map(online));
  ok(counts.every(c => c === 3), `4 personnes : chacun entend les 3 autres (${counts.join(', ')})`);

  // 3. Pseudo déjà pris dans le salon
  const dup = await open('Lucas'); await sleep(800);
  ok((await dup.$eval('.peer .n', e => e.textContent)).startsWith('Lucas 2'), 'pseudo en double : le second devient « Lucas 2 »');
  await dup.close(); await sleep(800);

  // 4. Départ puis retour d'un participant
  await P[3].close(); await sleep(1500);
  ok((await states(P[0])).length === 3, 'Sam part : il disparaît de la liste des autres');
  P[3] = await open('Sam'); await sleep(4000);
  ok(await online(P[3]) === 3 && await online(P[0]) === 3, 'Sam revient : reconnecté à tout le monde');

  // 5. Coupure et redémarrage du serveur (Render qui redémarre, réseau qui saute)
  srv.kill(); await sleep(1500);
  ok(await P[0].isVisible('#netBanner'), 'serveur coupé : bannière « Connexion perdue » affichée');
  await startServer(); await sleep(12000);
  ok(!(await P[0].isVisible('#netBanner')), 'serveur revenu : reconnexion automatique, bannière masquée');
  const after = await Promise.all(P.map(online));
  ok(after.every(c => c === 3), `après reconnexion : voix rétablie entre les 4 (${after.join(', ')})`);
  await P[1].fill('#chat-in', 'Toujours là ?'); await P[1].press('#chat-in', 'Enter'); await sleep(600);
  ok((await P[2].textContent('#chat')).includes('Toujours là ?'), 'après reconnexion : le chat fonctionne');
  const names = await P[0].$$eval('.peer .n', e => e.map(x => x.textContent));
  ok(!names.some(n => /\s2$/.test(n)), `après reconnexion : pas de pseudo dédoublé (${names.join(', ')})`);

  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await b.close(); srv.kill();
})().catch(e => { console.error(e); srv?.kill(); process.exit(1); });
