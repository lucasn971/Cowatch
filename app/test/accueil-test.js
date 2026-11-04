// Accueil de l'appli : la promesse « zéro revente » et le journal « Où va ta connexion » (donné par l'appli Android).
// Lancement : node app/test/accueil-test.js
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '../web');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const srv = http.createServer((q, r) => {
    const p = path.join(WEB, new URL(q.url, 'http://x').pathname);
    if (!p.startsWith(WEB) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(p)] || 'text/plain' });
    fs.createReadStream(p).pipe(r);
  }).listen(8093);
  const b = await chromium.launch({ headless: true });
  const pg = await b.newPage({ viewport: { width: 360, height: 800 } });
  const ext = []; const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== 'localhost') { ext.push(u.hostname); return r.abort(); } r.continue(); });
  await pg.goto('http://localhost:8093/accueil.html');
  await pg.waitForSelector('.tile');
  ok(await pg.locator('.promesse li').count() === 5 && (await pg.textContent('.promesse')).includes('notifications') && (await pg.textContent('.promesse')).includes('Revendre ta connexion'), 'accueil : la promesse « ce que Cowatch ne fera jamais » est affichée');
  ok(await pg.isHidden('#connexion'), 'sans l\'appli Android (iPhone, essai) : pas de journal vide affiché');
  ok(ext.every(h => /^fonts\.(googleapis|gstatic)\.com$/.test(h)), `l'accueil ne contacte que les polices (${[...new Set(ext)].join(', ') || 'rien'})`);
  await pg.evaluate(() => window.cowatchConfiance({
    depuis: Date.now() - 12 * 60000, envoye: 3456789, recu: 98765432,
    salon: [{ hote: 'salon-coche-private.onrender.com', n: 14 }, { hote: 'fonts.gstatic.com', n: 3 }],
    sites: [{ hote: 'www.crunchyroll.com', n: 40 }, { hote: '<img src=x onerror=window.__pirate=1>', n: 1 }],
    bloques: [{ hote: 'collecte.exemple.com', n: 2 }], sitesTotal: 2 }));
  ok(await pg.isVisible('#connexion'), 'l\'appli donne le journal : la section « Où va ta connexion » apparaît');
  const resume = await pg.textContent('#cx-resume');
  ok(/Depuis 12 min : 3,5 Mo envoyés, 99 Mo reçus/.test(resume), `volume lisible (${resume.slice(0, 60)}…)`);
  ok((await pg.textContent('#cx-salon')).includes('salon-coche-private.onrender.com') && (await pg.textContent('#cx-sites')).includes('www.crunchyroll.com'), 'sites du salon et sites regardés listés séparément');
  ok(await pg.isVisible('#cx-bloques') && (await pg.textContent('#cx-bloques')).includes('collecte.exemple.com'), 'les demandes bloquées sont montrées');
  ok(!(await pg.evaluate(() => window.__pirate)) && await pg.locator('#cx-sites img').count() === 0, 'un nom de site piégé reste du texte (rien d\'injecté)');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= 360), 'pas de défilement de côté sur un téléphone (360 px)');
  // Mode A : la section « Dans l'appli officielle » n'apparaît que sur Android (l'appli appelle cowatchApplis).
  ok(await pg.isHidden('#applis'), 'sans Android : pas de section « appli officielle » (iPhone, navigateur)');
  await pg.evaluate(() => window.cowatchApplis({ android: true, autorise: false, ok: false, etat: 'none', choisie: null }));
  await pg.waitForSelector('#applis:not([hidden]) .tile');
  const tuiles = await pg.$$eval('#applis-grille .tile', l => l.map(a => a.getAttribute('href')));
  ok(tuiles.length >= 6 && tuiles.includes('cowatch://appli/netflix') && tuiles.includes('cowatch://appli/canalplus'), `Android : ${tuiles.length} applis officielles proposées (Netflix, Canal+…)`);
  ok((await pg.textContent('#applis-etat')).includes('accès aux notifications'), 'avant l\'autorisation : on explique à quoi elle sert');
  await pg.evaluate(() => window.cowatchApplis({ android: true, autorise: true, ok: true, etat: 'playing', choisie: 'netflix', nom: 'Netflix', titre: 'Épisode 3' }));
  ok((await pg.textContent('#applis-etat')).includes('Netflix : en lecture · Épisode 3') && await pg.locator('#applis-fin').count() === 1, 'appli choisie : état de la lecture affiché, bouton pour arrêter');
  ok(await pg.locator('.tile.choisie[data-id="netflix"]').count() === 1, 'la tuile de l\'appli choisie est marquée');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= 360), 'toujours pas de défilement de côté avec la section des applis');
  ok(!errs.length, `aucune erreur JavaScript ${errs.join(' | ')}`);
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exitCode = 1; process.exit(); });
