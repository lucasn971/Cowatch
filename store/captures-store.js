// Captures 1280×800 pour la fiche Chrome Web Store : vidéo (960 px) + panneau Cowatch (320 px).
// Le lecteur de test est masqué derrière un décor neutre (aucune marque, aucune image d'un vrai programme).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const W = process.argv[2]; // dossier w/ des tests
const BASE = 'http://localhost:8080', EXT = path.join(W, 'extension'), OUT = process.argv[3];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SCENES = {
  stade: 'radial-gradient(ellipse 90% 45% at 50% 105%, #2E6B3A 0 60%, #1E4A28 61% 100%), radial-gradient(circle at 15% 8%, rgba(255,255,240,.55), transparent 22%), radial-gradient(circle at 85% 8%, rgba(255,255,240,.55), transparent 22%), linear-gradient(#0A1226, #04070F)',
  nuit: 'radial-gradient(60% 50% at 72% 28%, rgba(25,211,166,.22) 0%, transparent 70%), radial-gradient(120% 90% at 60% 20%, #173A31 0%, #0A1A16 55%, #040908 100%)',
  piste: 'linear-gradient(104deg, transparent 0 24%, rgba(244,244,242,.55) 24% 25.2%, transparent 25.2% 74.8%, rgba(244,244,242,.55) 74.8% 76%, transparent 76%), radial-gradient(90% 70% at 50% 0%, #3A3D44 0%, #24262B 60%, #17181B 100%)',
};
(async () => {
  const mk = dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + path.join(W, 'test', 'voice.wav')] });
  const cA = await mk('/tmp/claude-0/st-a'), cB = await mk('/tmp/claude-0/st-b');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  async function open(c, who, name) {
    const s = await sw(c), id = new URL(s.url()).host;
    const v = await c.newPage(); await v.setViewportSize({ width: 960, height: 800 });
    await v.goto(`${BASE}/test-player.html?who=${who}`);
    await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
    await v.evaluate(() => { document.title = 'Épisode 8'; const vid = document.querySelector('video'); vid.controls = false;
      const st = document.createElement('style'); st.textContent = 'p{display:none}video{width:100vw!important;height:100vh;opacity:0}body{background-size:cover!important}'; document.head.append(st); });
    const tab = await s.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u)).id, 'who=' + who);
    const p = await c.newPage(); await p.setViewportSize({ width: 320, height: 800 });
    await p.goto(`chrome-extension://${id}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
    await p.fill('#name', name); return { v, p };
  }
  const A = await open(cA, 'oct', 'Octave'), B = await open(cB, 'aga', 'Agathe');
  const scene = (X, k) => X.v.evaluate(bg => { document.body.style.background = bg; }, SCENES[k]);
  const shot = async (X, n) => { await X.v.screenshot({ path: `${OUT}/${n}-v.png` }); await X.p.screenshot({ path: `${OUT}/${n}-p.png` }); };
  const react = (X, em) => X.p.click(`#react button:text-is("${em}")`);
  const say = async (X, t) => { await X.p.fill('#chatIn', t); await X.p.press('#chatIn', 'Enter'); };

  // 1. Choix de l'ambiance
  await scene(A, 'nuit'); await A.p.click('#create'); await A.p.click('.card[data-id="anime"]'); await sleep(500); await shot(A, '1-choix');
  await A.p.click('#go'); await A.p.waitForSelector('#room:not(.hidden)');
  const code = await A.p.textContent('#code');
  await B.p.fill('#codeIn', code); await B.p.click('#joinBtn'); await B.p.waitForSelector('#room:not(.hidden)');
  await scene(B, 'nuit'); await sleep(7000);

  // 2. Anime : spoil flouté + PEAK
  await say(B, 'cet épisode, la claque'); await sleep(400); await say(A, '/spoil il revient au dernier épisode'); await sleep(1200);
  await react(A, '😭'); await sleep(150); await react(A, '🔥'); await react(B, '🔥');
  await sleep(380); await shot(B, '2-anime');

  // 3. Paddock : feux de départ + radio
  await A.p.click('#menuBtn'); await A.p.click('#mTheme'); await A.p.click('.card[data-id="paddock"]'); await A.p.click('#go');
  await scene(A, 'piste'); await scene(B, 'piste'); await sleep(2500);
  await say(B, 'il part en pole, ça va chauffer');
  await A.p.click('#lightsBtn'); await sleep(3700); await shot(B, '3-paddock');

  // 4. Vestiaire : réactions qui montent + celui qui parle
  await sleep(16000);
  await A.p.click('#menuBtn'); await A.p.click('#mTheme'); await A.p.click('.card[data-id="vestiaire"]'); await A.p.click('#go');
  await scene(A, 'stade'); await scene(B, 'stade'); await sleep(2500);
  await say(A, 'quel match ce soir'); await sleep(300);
  for (const em of ['🔥', '🔥', '🙌', '😤']) { await react(A, em); await sleep(120); }
  await react(B, '🔥'); await sleep(700); await shot(B, '4-vestiaire');
  await cA.close(); await cB.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
