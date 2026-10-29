// Cowatch — « arrière-plan » de l'appli : ce que fait background.js dans l'extension, pour l'écran du salon.
// Chargé avant le panneau ; il répond aux messages du lecteur (page du service) et du panneau.
(() => {
  const C = chrome.__coque;
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    // Lien d'invitation : salon à rejoindre, repris par le panneau (30 min).
    if (msg.cmd === 'pendingJoin') { chrome.storage.local.set({ pendingJoin: { code: msg.code, at: Date.now() } }).then(() => reply({ ok: true })); return true; }
    // Bulle « Rejoindre le salon » ou languette « Cowatch » sur la vidéo : l'appli déplie le salon.
    if (msg.cmd === 'openPanel' && sender.tab) { C.call('panel.open').then(() => reply({ ok: true, where: 'app' })); return true; }
    if (msg.cmd === 'panelState' && sender.tab) { C.call('panel.state').then(r => reply({ open: !!(r && r.open) })); return true; }
    // Polices d'ambiance pour les surcouches sur la vidéo : téléchargées ici, passées au lecteur en octets.
    if (msg.cmd === 'gfont' && typeof msg.q === 'string' && /^[\w+:;@,.=&-]+$/.test(msg.q)) { gfont(msg.q).then(reply, () => reply([])); return true; }
    if (msg.to !== 'bg') return;
    // Pas de document caché dans l'appli : le moteur tourne dans l'écran du salon, qui reste vivant (service de premier plan).
    if (msg.cmd === 'ensureEngine') { reply({ ok: false }); return; }
    if (msg.cmd === 'alive') { reply({ tab: true, panel: true }); return; }
    if (msg.cmd === 'relay') { chrome.tabs.sendMessage(msg.tabId, msg.m).catch(() => {}); return; }
  });

  const cache = new Map();
  function gfont(q) {
    if (!cache.has(q)) cache.set(q, (async () => {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?${q}&display=swap`)).text();
      const out = [];
      for (const m of css.matchAll(/\/\*\s*latin\s*\*\/\s*@font-face\s*{([^}]*)}/g)) {
        const b = m[1], g = re => (re.exec(b) || [])[1];
        const url = g(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/); if (!url) continue;
        const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
        let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        out.push({ family: g(/font-family:\s*'([^']+)'/), weight: g(/font-weight:\s*([\d ]+)/), style: g(/font-style:\s*(\w+)/) || 'normal', range: g(/unicode-range:\s*([^;]+)/), data: btoa(bin) });
      }
      return out;
    })().catch(e => { cache.delete(q); throw e; }));
    return cache.get(q);
  }
})();
