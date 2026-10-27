// Sondage anime (27/10) : case « 16 ans ou plus » pour commencer, nouvelles questions (téléphone, manga lu, spoil,
// salle d'attente), case « je veux tester », source du lien (?src=) gardée jusqu'au serveur.
// Usage : serveur local lancé avec sa sortie dans /tmp/claude-0/srv.log
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const BASE = 'http://localhost:8080', LOG = '/tmp/claude-0/srv.log', SHOTS = '/tmp/claude-0/shots';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`${BASE}/sondage/anime?src=Discord-AWFR`);
  ok(await p.isDisabled('#start'), 'on ne peut pas commencer sans cocher « J\'ai 16 ans ou plus »');
  await p.check('#age16'); ok(await p.isEnabled('#start'), 'case cochée : le bouton s\'active');
  await p.screenshot({ path: `${SHOTS}/sondage-intro.png` });
  await p.click('#start');
  const seen = [];
  for (let n = 0; n < 30; n++) {
    const title = await p.textContent('h2'); seen.push(title);
    if (/Android ou|Ton téléphone/.test(title)) await p.screenshot({ path: `${SHOTS}/sondage-telephone.png` });
    if (await p.$('#email')) break;
    const multi = await p.$('.hint:not(.row .hint)');
    if (await p.$('.pitch')) { await p.click('.btn.wide'); }
    else if (multi && !(await p.$('.scale'))) { await p.click('.opt >> nth=0'); await p.click('.btn.wide'); }
    else { await p.click('.opt >> nth=0'); }
    await sleep(350);
  }
  const all = seen.join(' | ');
  ok(/téléphone/i.test(all), 'question « Ton téléphone » posée');
  ok(/lu le manga/.test(all) && /spoiler/.test(all) && /salle d'attente/.test(all), 'questions manga lu, spoil et salle d\'attente posées');
  ok(!(await p.content()).includes('Moins de 16'), 'plus de tranche « moins de 16 »');
  await p.check('#tester'); await p.fill('#email', '');
  await p.screenshot({ path: `${SHOTS}/sondage-fin.png` });
  const before = fs.readFileSync(LOG, 'utf8').length;
  await p.click('.btn.wide');
  await p.waitForSelector('text=Réponses enregistrées', { timeout: 8000 }).catch(() => {});
  ok((await p.textContent('#app')).includes('Réponses enregistrées'), 'réponses envoyées');
  await sleep(300);
  const line = fs.readFileSync(LOG, 'utf8').slice(before).split('\n').find(l => l.startsWith('SONDAGE {'));
  const d = line ? JSON.parse(line.slice(8)) : {};
  ok(d.src === 'discord-awfr' && d.v === 2, `source du lien gardée (src=${d.src}, v=${d.v})`);
  const a = d.answers || {};
  ok(a.telephone === 'android' && a.manga_lu && a.spoil_subi && a.salle_attente, 'nouvelles réponses reçues par le serveur');
  ok(a.tester === 'oui' && a.age_ok === 'oui', 'case « je veux tester » et « 16 ans ou plus » reçues');
  await p.evaluate(() => navigator.clipboard && 0);
  const share = await p.evaluate(() => { let u = ''; navigator.clipboard.writeText = async x => { u = x; }; document.querySelector('.btn.wide').click(); return new Promise(r => setTimeout(() => r(u), 200)); });
  ok(share.endsWith('/sondage/anime?src=discord-awfr-partage'), 'le lien partagé garde la source (« -partage ») : ' + share);
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
