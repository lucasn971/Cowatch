// Crunchyroll et ADN (demande de Lucas, 28/10) : l'extension se charge sur ces sites et repère le lecteur,
// y compris quand la vidéo est dans un cadre intégré (Crunchyroll lit dans static.crunchyroll.com).
// Les sites sont simulés (pages factices servies à leur adresse) : l'essai réel reste à faire dans le Chrome de Lucas.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = fs.existsSync(path.join(__dirname, 'manifest.json')) ? __dirname : path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await sleep(200); } return false; };
const VID = fs.readFileSync(path.join(EXT, 'test.webm'));
const page = body => ({ status: 200, contentType: 'text/html', body: `<!doctype html><body style="margin:0">${body}</body>` });
const videoTag = '<video src="/v.webm" muted autoplay loop style="width:960px;height:540px"></video>';
(async () => {
  const c = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cr-')), { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'] });
  await c.route(/^https:\/\/[^/]*(crunchyroll\.com|animationdigitalnetwork\.(fr|com))\//, r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/v.webm') return r.fulfill({ status: 200, contentType: 'video/webm', body: VID });
    if (u.hostname === 'static.crunchyroll.com') return r.fulfill(page(videoTag));
    if (u.hostname.endsWith('crunchyroll.com')) return r.fulfill(page('<iframe src="https://static.crunchyroll.com/vilos-v2/web/vilos/player.html" allow="fullscreen" style="width:980px;height:560px;border:0"></iframe>'));
    return r.fulfill(page(videoTag));
  });
  let sw = c.serviceWorkers()[0] || await c.waitForEvent('serviceworker');
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  for (const h of ['crunchyroll.com', 'animationdigitalnetwork.fr', 'animationdigitalnetwork.com'])
    ok(m.host_permissions.some(u => u.includes(h)) && m.content_scripts.filter(s => s.js.includes('coeur/player.js') || s.js.includes('coeur/clock.js')).every(s => s.matches.some(u => u.includes(h))), `manifeste : ${h} autorisé et scripts chargés`);
  await sw.evaluate(() => { globalThis.__seen = []; chrome.runtime.onMessage.addListener((msg, s) => { if (msg && (msg.cmd === 'site' || msg.cmd === 'video')) globalThis.__seen.push({ cmd: msg.cmd, host: msg.host, frame: s.frameId }); }); });
  const p = await c.newPage();
  for (const [url, host, cadre] of [['https://www.crunchyroll.com/fr/watch/G0XHWM1JP/episode', 'static.crunchyroll.com', true], ['https://animationdigitalnetwork.fr/video/one-piece/1', 'animationdigitalnetwork.fr', false], ['https://animationdigitalnetwork.com/video/frieren/2', 'animationdigitalnetwork.com', false]]) {
    await p.goto(url);
    const seen = await until(() => sw.evaluate(h => globalThis.__seen.some(x => x.cmd === 'site' && x.host === h), host));
    ok(seen, `${new URL(url).hostname} : lecteur repéré (${host}${cadre ? ', dans le cadre intégré' : ''})`);
    if (cadre) ok(await sw.evaluate(h => globalThis.__seen.some(x => x.host === h && x.frame > 0), host), 'Crunchyroll : repérage fait dans le cadre (pas la page principale)');
  }
  // L'invitation ouvre le site : la page /j/ accepte les adresses Crunchyroll et ADN (même liste que le panneau).
  const join = fs.readFileSync(path.join(__dirname, fs.existsSync(path.join(__dirname, 'join.html')) ? 'join.html' : '../join.html'), 'utf8');
  const panel = fs.readFileSync(path.join(EXT, 'coeur', 'panel.js'), 'utf8');
  for (const h of ['crunchyroll.com', 'animationdigitalnetwork.fr', 'animationdigitalnetwork.com']) ok(join.includes(`'${h}'`) && panel.includes(`'${h}'`), `invitation : ${h} accepté (page /j/ et panneau)`);
  await c.close();
})().catch(e => { console.error(e); process.exit(1); });
