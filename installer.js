// Page d'installation (/installer) : téléchargement de cowatch.zip, étapes, « Cowatch est installé », retour à l'invitation.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os'), { execSync } = require('child_process');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  // 1. Sans extension : les étapes, le bon fichier
  const b = await chromium.launch({ headless: true }); const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(BASE + '/j/ABCDE?u=' + encodeURIComponent('https://www.netflix.com/watch/1'));
  const inst = await pg.getAttribute('#inst', 'href');
  ok(inst.startsWith('/installer?r=') && decodeURIComponent(inst).includes('/j/ABCDE'), 'invitation sans extension : lien « Installe l\'extension Cowatch » vers /installer');
  await pg.goto(BASE + inst);
  ok(await pg.isVisible('#steps') && await pg.isHidden('#ok'), 'les 4 étapes sont affichées');
  ok(await pg.isVisible('#back') && (await pg.getAttribute('#back', 'href')).startsWith('/j/ABCDE'), 'bouton « Revenir à l\'invitation »');
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#dl')]);
  const zip = path.join(os.tmpdir(), 'cw-test.zip'); await dl.saveAs(zip);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwz-')); execSync(`unzip -q ${zip} -d ${dir}`);
  ok(fs.existsSync(path.join(dir, 'Cowatch', 'manifest.json')), 'le téléchargement donne un dossier « Cowatch » avec l\'extension');
  await pg.setViewportSize({ width: 360, height: 800 });
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= 360), 'pas de défilement de côté sur un petit écran');
  await pg.goto(BASE + '/installer?r=' + encodeURIComponent('https://pirate.example'));
  ok(await pg.isHidden('#back'), 'retour vers un autre site refusé');
  await b.close();
  // 2. Le dossier téléchargé s'installe, et la page dit « installé »
  const c = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cwp-')), { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${path.join(dir, 'Cowatch')}`, `--load-extension=${path.join(dir, 'Cowatch')}`] });
  const sw = c.serviceWorkers()[0] || await c.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
  ok(!!sw, 'le dossier Cowatch téléchargé se charge dans Chrome');
  const p2 = await c.newPage(); await p2.goto(BASE + '/installer');
  ok(await p2.waitForSelector('#ok:not([hidden])', { timeout: 5000 }).then(() => true).catch(() => false), 'extension présente : « ✓ Cowatch est installé »');
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await c.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
