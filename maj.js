// Mise à jour de Cowatch sans recharger la page (essai de Lucas, 23/10, 17:02) : l'ancienne instance laissait
// une languette morte (le clic ne faisait plus rien). Après la mise à jour : plus de restes, la nouvelle instance répond,
// et la languette rouvre bien le panneau.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await sleep(200); } return false; };

(async () => {
  const c = await chromium.launchPersistentContext('/tmp/claude-0/maj', { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  let sw = c.serviceWorkers()[0] || await c.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const errs = [];
  const v = await c.newPage(); v.on('pageerror', e => errs.push(e.message));
  await v.goto(`${BASE}/test-player.html?who=maj`); await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
  const tabOf = async () => sw.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url.includes('who=maj')).id);
  async function salon(name) {
    const p = await c.newPage();
    await p.goto(`chrome-extension://${id}/panel.html?tab=${await tabOf()}&server=${encodeURIComponent(BASE)}`);
    await p.waitForTimeout(800);
    if (await p.isHidden('#room')) { await p.fill('#name', name); await p.click('#create'); await p.click('#go'); }
    await p.waitForSelector('#room:not(.hidden)');
    return p;
  }
  const reopenCount = () => v.evaluate(() => document.querySelectorAll('#cowatch-reopen').length);
  let p = await salon('Lucas'); await sleep(1000);
  await p.close(); // panneau fermé : la languette apparaît
  ok(await until(async () => (await reopenCount()) === 1), 'avant la mise à jour : une languette');

  // Mise à jour sans recharger la page, comme le bouton ↻ : Cowatch se réinjecte dans l'onglet ouvert (reinject),
  // et l'ancienne version laisse ses éléments dans la page. On simule aussi une languette d'une très vieille version.
  await v.evaluate(() => { const b = document.createElement('button'); b.id = 'cowatch-reopen'; b.textContent = 'vieille'; document.documentElement.append(b); });
  ok(await until(async () => !(await v.evaluate(() => [...document.querySelectorAll('#cowatch-reopen')].some(b => b.textContent === 'vieille')))), 'une languette laissée par une ancienne version est effacée');
  await sw.evaluate(() => self.reinject());
  await sleep(2500);
  ok(await until(async () => (await reopenCount()) <= 1, 6000), `après la réinjection : pas de languette en double (${await reopenCount()})`);
  ok(await sw.evaluate(async t => !!(await chrome.tabs.sendMessage(t, { t: 'has-video' }).catch(() => null)), await tabOf()), 'la nouvelle instance de Cowatch répond dans la page');

  // On rouvre Cowatch (le salon est toujours là) puis on le referme : la languette de la nouvelle version marche
  p = await salon('Lucas'); await sleep(1000); await p.close();
  ok(await until(async () => (await reopenCount()) === 1), 'panneau refermé : une seule languette, de la nouvelle version');
  const before = c.pages().length;
  await v.bringToFront(); await v.click('#cowatch-reopen');
  ok(await until(async () => c.pages().length > before || await sw.evaluate(() => chrome.runtime.getContexts ? chrome.runtime.getContexts({}).then(x => x.some(k => k.contextType === 'SIDE_PANEL' || (k.documentUrl || '').includes('panel.html'))) : false)), 'clic sur la languette : le panneau se rouvre');
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await c.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
