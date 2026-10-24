// Lot 7 : statistiques anonymes de séance, envoyées aux data analysts après chaque séance (demande de Lucas, 24/10).
// Un faux « script Google » (port 8097) reçoit l'envoi : on vérifie le contenu, l'anonymat et le respect de l'accord.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'), http = require('http');
const BASE = 'http://localhost:8080';
const EXT = path.resolve(__dirname, '../extension');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await sleep(200); } return false; };

const got = [];
http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { got.push(JSON.parse(b)); } catch {} res.end('{"ok":true}'); }); }).listen(8097);

(async () => {
  const st = await (await fetch(BASE + '/stats')).json();
  ok(st.statsSeances === true, 'serveur de test : envoi des statistiques activé (TELEMETRY_URL)');
  const mk = dir => chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const cA = await mk('/tmp/claude-0/sta'), cB = await mk('/tmp/claude-0/stb');
  const sw = async c => c.serviceWorkers()[0] || c.waitForEvent('serviceworker');
  const errs = [];
  async function open(c, who, name) {
    const s = await sw(c), id = new URL(s.url()).host;
    const v = await c.newPage(); await v.goto(`${BASE}/test-player.html?who=${who}`); await v.waitForFunction(() => document.querySelector('video').readyState >= 1);
    const tab = await s.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.includes(u)).id, 'who=' + who);
    const p = await c.newPage(); p.on('pageerror', e => errs.push(name + ' ' + e.message));
    await p.goto(`chrome-extension://${id}/panel.html?tab=${tab}&server=${encodeURIComponent(BASE)}`);
    await p.fill('#name', name); return { v, p };
  }
  const A = await open(cA, 'lucas', 'Lucas'), B = await open(cB, 'kilian', 'Kilian');
  ok(await A.p.isVisible('#consentBox'), 'premier lancement : l\'accord est demandé (version de test)');
  await A.p.click('#consentYes'); await B.p.click('#consentNo');
  ok(await A.p.isHidden('#consentBox') && await B.p.isHidden('#consentBox'), 'une fois répondu, la question disparaît');
  await A.p.click('#create'); await A.p.click('#go'); await A.p.waitForSelector('#room:not(.hidden)');
  const code = await A.p.textContent('#code');
  await B.p.fill('#codeIn', code); await B.p.click('#joinBtn'); await B.p.waitForSelector('#room:not(.hidden)');
  await sleep(6500); // 1er rapport de chaque extension (5 s après l'entrée)
  await A.p.fill('#chatIn', 'message très secret'); await A.p.press('#chatIn', 'Enter');
  for (let i = 0; i < 3; i++) { await B.p.click('#react button:nth-child(2)'); await sleep(150); }
  await A.p.fill('#pH', '2'); await A.p.fill('#pA', '1'); await A.p.click('#pGo');
  await sleep(800);
  for (const P of [A, B]) { await P.p.click('#menuBtn'); await P.p.click('#leave'); }
  ok(await until(async () => got.length > 0, 15000), 'fin de séance (salon vide) : les statistiques partent toutes seules');
  const d = got[0] || {}, s = d.session || {}, raw = JSON.stringify(d);
  ok(s.participants === 2 && s.avec_video === 2, `séance : 2 participants, 2 vidéos reliées (${s.participants}, ${s.avec_video})`);
  ok(s.messages === 1 && s.reactions >= 3 && s.pronos === 1, `compteurs : 1 message, ${s.reactions} réactions, ${s.pronos} prono`);
  ok(s.duree_s > 5 && s.ambiance === 'vestiaire' && s.accords === 1, `durée ${s.duree_s} s, ambiance ${s.ambiance}, ${s.accords} accord`);
  const pa = (d.participants || []).find(p => p.site), pb = (d.participants || []).find(p => p.accord === 0);
  ok(!!pa && pa.site === 'localhost' && pa.version && pa.micro, `participant d'accord : site, version, micro (${pa && [pa.site, pa.version, pa.micro].join(', ')})`);
  ok(!!pb && !pb.site && !pb.version, 'participant qui a refusé : aucun détail, seulement compté');
  ok(!/Lucas|Kilian/.test(raw), 'aucun pseudo dans l\'envoi');
  ok(!/secret/.test(raw), 'aucun texte de message dans l\'envoi');
  ok(!raw.includes(code), 'pas le code du salon');
  ok((d.evenements || []).some(e => e.type === 'arrivee') && (d.participants || []).every(p => /^[0-9a-f]{12}$/.test(p.id)), 'événements horodatés, participants en identifiants au hasard');
  ok(errs.length === 0, 'aucune erreur JS ' + errs.join(' | '));
  await cA.close(); await cB.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
