// Content script : repère la vidéo principale de la page et applique / émet les commandes de lecture.
(() => {
  // Une seule instance vivante par page. Après une mise à jour de Cowatch, l'ancienne instance reste dans la page
  // (sans pouvoir parler à l'extension) : la nouvelle prend la main et efface ses restes (languette morte, etc.).
  // Une instance encore vivante (Cowatch injecté deux fois, par exemple à l'installation) garde la main : on lui demande
  // par un événement de la page, qui répond tout de suite si elle peut encore parler à l'extension.
  let otherAlive = false; const onPong = () => { otherAlive = true; };
  document.addEventListener('cowatch-pong', onPong); document.dispatchEvent(new CustomEvent('cowatch-ping')); document.removeEventListener('cowatch-pong', onPong);
  if (otherAlive) return;
  const INST = Math.random().toString(36).slice(2);
  window.__salonSync = INST;
  document.addEventListener('cowatch-ping', () => { if (alive()) document.dispatchEvent(new CustomEvent('cowatch-pong')); });
  const alive = () => window.__salonSync === INST && !!(chrome.runtime && chrome.runtime.id);
  const mine = el => { el.dataset.cwInst = INST; return el; };
  const stale = n => n.nodeType === 1 && typeof n.id === 'string' && n.id.startsWith('cowatch-') && n.dataset.cwInst !== INST;
  document.querySelectorAll('[id^="cowatch-"]').forEach(n => { if (stale(n)) n.remove(); });
  const sweeper = new MutationObserver(muts => { if (!alive()) return; for (const m of muts) for (const n of m.addedNodes) if (stale(n)) n.remove(); });
  sweeper.observe(document.documentElement, { childList: true, subtree: true });
  const retire = setInterval(() => { if (alive()) return; clearInterval(retire); sweeper.disconnect(); document.querySelectorAll('[id^="cowatch-"]').forEach(n => { if (n.dataset.cwInst === INST) n.remove(); }); }, 2000);
  let video = null, me = null, host = null, offset = 0, ignoreUntil = 0, stateTimer = null, mode = 'vod', alignTimer = null;
  const DRIFT = 0.8;           // tolérance de dérive en secondes avant recalage
  const isHost = () => me && me === host;
  const quiet = (ms = 700) => { ignoreUntil = Date.now() + ms; };

  // Cherche aussi dans les « shadow DOM » ouverts (certains lecteurs y cachent leur <video>).
  function allVideos(root = document, out = [], depth = 0) {
    root.querySelectorAll('video').forEach(v => out.push(v));
    if (depth < 6) root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) allVideos(el.shadowRoot, out, depth + 1); });
    return out;
  }
  // Les clics sur Cowatch posé sur la vidéo (languette, barre d'émojis, volet prono, récap) ne doivent jamais atteindre
  // le lecteur du site : Netflix met en pause au clic, et la synchro mettrait alors en pause tout le salon (essai de Lucas, 23/10).
  let uiTouchAt = 0;
  const ourUi = t => t && t.closest && t.closest('[id^="cowatch-"]');
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'contextmenu']) {
    window.addEventListener(type, e => {
      if (!alive()) return;
      const el = ourUi(e.target); if (!el || el.dataset.cwInst !== INST) return;
      uiTouchAt = Date.now();
      e.stopImmediatePropagation(); // personne d'autre (le lecteur du site) ne voit ce clic
      if (type === 'click') { // on déclenche nous-mêmes l'action de l'élément cliqué
        let n = e.target;
        while (n && n !== el.parentNode && typeof n.onclick !== 'function') n = n.parentNode;
        if (n && typeof n.onclick === 'function') n.onclick.call(n, e);
      }
      if (type === 'dblclick') e.preventDefault(); // pas de plein écran au double clic
    }, true);
  }
  function findVideo() {
    const vids = allVideos().filter(v => v.readyState > 0 || v.src || v.currentSrc);
    // Prime Video garde deux vidéos de même taille (pub + programme) : à taille égale, celle qui joue, puis la plus longue.
    const area = v => Math.round(v.clientWidth * v.clientHeight / 1000), len = v => isFinite(v.duration) ? v.duration : 1e9;
    vids.sort((a, b) => area(b) - area(a) || (a.paused - b.paused) || len(b) - len(a));
    return vids[0] || null;
  }
  // Journal du diagnostic automatique (gardé par le moteur ; rien n'est envoyé au serveur).
  const tr = (k, d, bad) => { try { chrome.runtime.sendMessage({ cmd: 'trace', k, d: String(d ?? ''), bad: !!bad }).catch(() => {}); } catch {} };
  function attach(v) {
    if (!v || v === video) return;
    video = v;
    // Filet de sécurité : si le site met quand même en pause juste après un clic sur Cowatch, on relance aussitôt.
    v.addEventListener('pause', () => { if (Date.now() - uiTouchAt < 1500 && Date.now() >= ignoreUntil && v === video) { quiet(); v.play().catch(() => {}); tr('pause évitée', 'clic sur Cowatch'); } });
    chrome.runtime.sendMessage({ cmd: 'video', found: true }).catch(() => {});
    chrome.runtime.sendMessage({ cmd: 'site', host: location.hostname }).catch(() => {});
    tr('vidéo', `${location.hostname} ${v.clientWidth}×${v.clientHeight}${isFinite(v.duration) ? '' : ' direct'}`);
    v.addEventListener('error', () => tr('erreur vidéo', `code ${v.error?.code || '?'} ${v.error?.message || ''}`.trim(), true));
    for (const ev of ['play', 'pause', 'seeked']) v.addEventListener(ev, () => {
      if (Date.now() < ignoreUntil || !me || mode !== 'vod' || isLive(v)) return; // en direct, chacun garde son flux
      if (ev === 'pause' && Date.now() - uiTouchAt < 1500) return; // pause causée par un clic sur Cowatch : jamais envoyée aux autres
      emit(ev === 'seeked' ? 'seek' : ev);
    });
  }
  function emit(action) {
    if (!video || isLive(video)) return;
    chrome.runtime.sendMessage({ cmd: 'sync', action, time: video.currentTime, playing: !video.paused, rate: video.playbackRate }).catch(() => {}); // vers le panneau
  }
  // Direct ou replay ? (durée infinie ou gigantesque = direct, comme sur Canal+)
  let lastKind = null;
  const isLive = v => v.dataset.cowatchLive === '1' || !isFinite(v.duration) || v.duration > 1e6;
  // Calage automatique du direct : la position du lecteur Canal+ correspond à l'heure réelle de l'image
  // (secondes depuis 2015). On l'envoie toutes les 2 s ; le serveur compare les participants et met en pause ceux en avance.
  let clockTick = 0;
  // Heure réelle de l'image affichée, en secondes. Trois sources, de la plus sûre à la moins sûre :
  //  - « morceaux » : correspondance relevée par clock.js (heure de chaque morceau du direct ↔ temps de la vidéo) ;
  //  - « lecteur »  : le lecteur compte déjà en heure réelle (Canal+) ;
  //  - « dash »     : début du direct annoncé par le flux + temps de la vidéo.
  function realPos(v) {
    const t = v.currentTime, now = Date.now(), ok = w => Math.abs(now - w) < 15 * 60 * 1000;
    try {
      const map = JSON.parse(v.getAttribute('data-cowatch-map') || 'null');
      if (map && map.length) {
        let best = map[0]; for (const s of map) if (s.m <= t + 0.05) best = s;
        const w = t * 1000 + best.off; if (ok(w)) return { pos: w / 1000, how: 'morceaux' };
      }
    } catch {}
    const epoch = t + (Number(v.dataset.cowatchEpoch) || 0); // cowatchEpoch : uniquement pour les tests
    if (ok(epoch * 1000)) return { pos: epoch, how: 'lecteur' };
    // Canal+ compte en secondes depuis le 1er janvier 2015 (et non 1970) : constaté en vrai le 22/10.
    const c2015 = t + 1420070400;
    if (t > 1e8 && ok(c2015 * 1000)) return { pos: c2015, how: 'lecteur' };
    const ast = Number(v.getAttribute('data-cowatch-ast'));
    if (ast && ok(ast + t * 1000)) return { pos: ast / 1000 + t, how: 'dash' };
    return { pos: t, how: 'aucune' };
  }
  setInterval(() => {
    attach(findVideo());
    // En direct, l'heure de l'image part dès que le SALON est en direct, même si cette page croit lire un replay
    // (ticket du 24/10 : un invité arrivé dans un salon déjà en direct n'envoyait rien et n'était jamais calé).
    if (me && video && mode === 'live' && ++clockTick % 2 === 0) {
      const pos = realPos(video).pos;
      chrome.runtime.sendMessage({ cmd: 'clock', pos, paused: video.paused || Date.now() < ignoreUntil }).catch(() => {});
    }
    if (video && video.readyState > 0) { const k = isLive(video); if (k !== lastKind) { lastKind = k; chrome.runtime.sendMessage({ cmd: 'kind', live: k }).catch(() => {}); } }
  }, 1000);
  chrome.runtime.sendMessage({ cmd: 'hello' }).catch(() => {}); // page (re)chargée : le panneau renvoie l'état du salon
  if (window.top === window) chrome.runtime.sendMessage({ cmd: 'panelState' }).then(r => { if (r && typeof r.open === 'boolean') { panelOpen = r.open; renderReopen(); } }).catch(() => {});

  // Invitation en attente : petite bulle qui ouvre le panneau d'un clic.
  if (window.top === window) chrome.storage.local.get('pendingJoin').then(({ pendingJoin }) => {
    if (!pendingJoin || Date.now() - pendingJoin.at > 30 * 60 * 1000) return;
    const b = document.createElement('button');
    b.textContent = `Rejoindre le salon ${pendingJoin.code}`;
    b.style.cssText = 'position:fixed;right:20px;top:84px;z-index:2147483647;background:#F4F6FA;color:#060A1C;border:0;border-radius:999px;padding:12px 18px;font:700 14px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer';
    b.onclick = async () => { const r = await chrome.runtime.sendMessage({ cmd: 'openPanel' }).catch(() => null); if (r && r.ok) b.remove(); else b.textContent = 'Clique sur l\'icône Cowatch en haut à droite'; };
    document.documentElement.append(b);
  }).catch(() => {});

  // Le pilote publie son état toutes les 3 s : les autres corrigent leur dérive.
  function startStateLoop() {
    clearInterval(stateTimer);
    stateTimer = setInterval(() => { if (mode === 'vod' && isHost() && video && !video.paused) emit('state'); }, 3000);
  }

  // Se déplacer dans la vidéo. Netflix plante (erreur M7375) si on change directement la position de la vidéo :
  // on passe alors par sa propre commande, via clock.js qui tourne dans la page.
  function seekTo(t) {
    if (/(^|\.)netflix\.com$/.test(location.hostname)) document.dispatchEvent(new CustomEvent('cowatch-cmd', { detail: JSON.stringify({ seek: t }) }));
    else video.currentTime = t;
  }
  async function apply(m) {
    if (!video || mode !== 'vod' || isLive(video)) return; // une vidéo en direct n'obéit jamais aux play / pause / avance d'un replay
    const now = Date.now() + offset;
    const target = m.time + (m.playing ? Math.max(0, now - m.sentAt) / 1000 * (m.rate || 1) : 0);
    const drift = video.currentTime - target;
    if (m.action === 'state' && Math.abs(drift) < DRIFT && video.paused === !m.playing) return;
    quiet();
    if (Math.abs(drift) > (m.action === 'state' ? DRIFT : 0.3)) {
      seekTo(target); tr('synchro', `${m.action} de ${m.name || '?'} : écart ${drift.toFixed(2)} s`);
      const v = video; setTimeout(() => { if (v === video && Math.abs(v.currentTime - (target + (m.playing ? 2 : 0))) > 2.5) tr('déplacement raté', `voulu ${target.toFixed(1)} s, obtenu ${v.currentTime.toFixed(1)} s`, true); }, 2000);
    }
    if (m.playing && video.paused) { try { await video.play(); } catch { banner('Clique sur ▶ pour rejoindre la lecture'); tr('lecture refusée', 'le site attend un clic'); } }
    if (!m.playing && !video.paused) video.pause();
  }

  // Alignement en direct : on se met en pause le temps de son avance, puis on relance.
  // Fonctionne si le lecteur autorise la pause du direct (Canal+ : "contrôle du direct", à vérifier sur chaque chaîne).
  // Calage du direct :
  //  - en avance de plus de 3 s : pause le temps de l'avance, puis reprise ;
  //  - en avance de 3 s ou moins : léger ralenti (0,75×), presque invisible, sans figer l'image ;
  //  - en retard (sec < 0) : on avance d'autant (le lecteur d'en face ne peut pas prendre plus de retard).
  // Recul dans le direct : plus fiable qu'une longue pause (certains lecteurs repartent ailleurs après 10 s de pause).
  function seekBackLive(sec) {
    try {
      const sk = video.seekable; if (!sk.length) return false;
      const to = video.currentTime - sec; if (to < sk.start(sk.length - 1) + 10) return false; // trop près du début de la fenêtre du direct : le lecteur sauterait ailleurs
      quiet(4000); seekTo(to);
      const v = video; setTimeout(() => { if (v === video && Math.abs(v.currentTime - to) > 2.5 + 2) { tr('déplacement raté', `recul de ${sec.toFixed(1)} s non appliqué`, true); v.pause(); setTimeout(() => v.play().catch(() => {}), sec * 1000); } }, 2000);
      return true;
    } catch { return false; }
  }
  let lastAlign = { at: 0, sec: 0 };
  function align(sec, auto) {
    if (!video || !sec) return;
    if (Date.now() - lastAlign.at < 1500 && Math.abs(lastAlign.sec - sec) < 0.05) return; // même ordre reçu deux fois : un recul ne doit pas s'additionner
    lastAlign = { at: Date.now(), sec };
    tr('calage', `${sec > 0 ? 'avance' : 'retard'} ${Math.abs(sec).toFixed(2)} s${auto ? ' (auto)' : ''}`);
    clearTimeout(alignTimer); video.playbackRate = 1;
    if (sec < 0) {
      let to = video.currentTime - sec;
      try { const sk = video.seekable; if (sk.length) to = Math.min(to, sk.end(sk.length - 1) - 1); } catch {}
      quiet(4000); seekTo(to);
      if (auto) banner('Calage avec le salon…');
      return;
    }
    if (auto && sec <= 3) {
      const dur = sec / 0.25; quiet(dur * 1000 + 1500); video.playbackRate = 0.75;
      alignTimer = setTimeout(() => { quiet(); video.playbackRate = 1; }, dur * 1000);
      return;
    }
    if (auto && mode === 'live' && sec > 3 && seekBackLive(sec)) { banner(`Calage avec le salon… (${sec.toFixed(1)} s)`); return; }
    quiet(sec * 1000 + 1500);
    video.pause();
    banner(auto ? `Calage avec le salon… (${sec.toFixed(1)} s)` : `Alignement : pause ${sec.toFixed(1)} s`);
    alignTimer = setTimeout(async () => { quiet(); try { await video.play(); banner('Calé ✓'); } catch { banner('Clique sur ▶ pour reprendre'); tr('reprise refusée', 'après la pause de calage', true); } }, sec * 1000);
  }

  // ---------- Calques Cowatch sur la vidéo ----------
  // En plein écran, seul l'élément affiché en plein écran est visible : on y place nos calques.
  function layerParent() { const f = document.fullscreenElement || document.webkitFullscreenElement; return f && f.tagName !== 'VIDEO' && f.tagName !== 'IFRAME' ? f : document.documentElement; }
  // Qui dessine les calques ? La page, sauf quand le plein écran du site se fait dans un lecteur intégré
  // (iframe, comme TF1 ou Canal+) : c'est alors ce lecteur, seul visible, qui les affiche.
  function isDisplayFrame() {
    const f = document.fullscreenElement || document.webkitFullscreenElement;
    if (f && f.tagName !== 'IFRAME') return true;
    if (window.top !== window) return false;
    return !(f && f.tagName === 'IFRAME');
  }
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches; // « moins d'animations » demandé : tout s'arrête
  const TT = self.CowatchThemes;
  let theme = TT ? TT.DEFAULT : 'vestiaire';
  const th = () => (TT ? TT.get(theme) : { emojis: ['😂', '🔥', '😱', '👀', '👏', '💀'], labels: [], bg: '#060A1C', text: '#F4F6FA', accent: '#F4F6FA', accentInk: '#060A1C', speaking: '#7CE0A3', display: 'system-ui', body: 'system-ui', radius: '10px' });
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  // Un calque par usage, tous replacés dans le plein écran quand il change.
  const layers = {};
  function layer(id, css) {
    if (!isDisplayFrame()) { layers[id]?.remove(); return null; }
    let el = layers[id];
    if (!el) { el = layers[id] = mine(document.createElement('div')); el.id = id; el.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;' + css; }
    const par = layerParent(); if (el.parentNode !== par) par.append(el);
    return el;
  }
  // Polices du Vestiaire, fournies avec l'extension (chargées en mémoire : la page ne peut pas les bloquer).
  const fontsDone = new Set();
  function loadFonts() {
    if (fontsDone.has(theme)) return; fontsDone.add(theme);
    if (theme !== 'vestiaire') { // autres ambiances : polices Google demandées au service worker, reçues en octets
      const q = th().gfont; if (!q) return;
      chrome.runtime.sendMessage({ cmd: 'gfont', q }).then(list => {
        for (const f of list || []) {
          try { const bin = atob(f.data), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
            new FontFace(f.family, u, { weight: f.weight || '400', style: f.style, unicodeRange: f.range || undefined }).load().then(ff => document.fonts.add(ff)).catch(() => {}); } catch {}
        }
      }).catch(() => {});
      return;
    }
    const list = [['Barlow Condensed', '800', 'BarlowCondensed-ExtraBold'], ['Barlow Condensed', '700', 'BarlowCondensed-Bold'], ['Barlow', '600', 'Barlow-SemiBold'], ['Barlow', '400', 'Barlow-Regular']];
    for (const [fam, w, f] of list) fetch(chrome.runtime.getURL(`fonts/${f}.woff`)).then(r => r.arrayBuffer()).then(buf => { const ff = new FontFace(fam, buf, { weight: w }); return ff.load(); }).then(ff => document.fonts.add(ff)).catch(() => {});
  }
  let bannerEl;
  function banner(txt) {
    const box = layer('cowatch-banner', 'top:14px;left:50%;transform:translateX(-50%);max-width:70vw'); if (!box) return;
    const t = th();
    box.style.cssText += `;background:${rgba(t.bg, .82)};color:${t.text};font:600 13px ${t.body};padding:8px 14px;border-radius:${t.radius};border:1px solid ${rgba(t.text, .18)}`;
    box.textContent = txt; box.style.display = 'block'; bannerEl = box;
    clearTimeout(box._t); box._t = setTimeout(() => { box.style.display = 'none'; }, 3500);
  }

  // Diagnostic (lecture seule) : décrit le lecteur pour savoir si un calage 100 % automatique est possible.
  function rangeList(r) { const a = []; try { for (let i = 0; i < r.length; i++) a.push([+r.start(i).toFixed(2), +r.end(i).toFixed(2)]); } catch {} return a; }
  function snap(v) {
    const sk = rangeList(v.seekable), bf = rangeList(v.buffered);
    let startDate = null; try { const d = v.getStartDate && v.getStartDate(); if (d && !isNaN(d.getTime())) startDate = d.toISOString(); } catch {}
    return { t: Date.now(), currentTime: +v.currentTime.toFixed(3), duration: v.duration === Infinity ? 'Infinity' : +(+v.duration).toFixed(2),
      paused: v.paused, readyState: v.readyState, rate: v.playbackRate, size: v.videoWidth + 'x' + v.videoHeight,
      src: (v.currentSrc || v.src || '').split(':')[0], seekable: sk, buffered: bf,
      edgeGap: sk.length ? +(sk[sk.length - 1][1] - v.currentTime).toFixed(2) : null, startDate };
  }
  async function diagnose() {
    const all = allVideos(), light = all.length - document.querySelectorAll('video').length;
    const res = performance.getEntriesByType('resource').map(e => e.name).filter(n => /\.m3u8|\.mpd|manifest|\.ism/i.test(n))
      .slice(-6).map(n => { try { const u = new URL(n); return u.hostname + u.pathname.slice(-60); } catch { return n.slice(0, 80); } });
    const scripts = [...document.scripts].map(s => s.src).filter(Boolean).map(s => s.split('/').pop().split('?')[0]).filter(n => /rx|shaka|hls|dash|bitmovin|player|video/i.test(n)).slice(0, 8);
    const out = { frame: location.hostname + location.pathname.slice(0, 40), top: window.top === window, videos: all.length, inShadow: light, picked: video ? 'oui' : 'non', manifests: res, scripts };
    if (video) {
      const a = snap(video); await new Promise(r => setTimeout(r, 2000)); const b = snap(video);
      const rp = realPos(video); out.clock = { how: rp.how, lagSec: rp.how === 'aucune' ? null : +((Date.now() / 1000) - rp.pos).toFixed(2), map: (video.getAttribute('data-cowatch-map') || '').length };
      out.sampleA = a; out.sampleB = b; out.advance = +((b.currentTime - a.currentTime) / ((b.t - a.t) / 1000)).toFixed(3);
    }
    return out;
  }

  // ---------- Celui qui parle : lui seul, avatar rond + prénom, anneau qui pulse ----------
  let roster = new Map(), pronos = [];
  const speaking = new Map(); // id -> timer de disparition
  const speakingNow = new Set(); // qui parle en ce moment (gardé même quand ce cadre n'affiche rien)
  function colorOf(name) { let h = 0; for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
  function faceLayer() {
    // Vestiaire : le prono occupe le haut à gauche, celui qui parle passe en bas à gauche (maquette D3).
    const bottom = theme === 'vestiaire' || theme === 'paddock'; // Paddock : la radio en bas à gauche (maquette G3)
    const box = layer('cowatch-faces', 'display:flex;flex-direction:column;align-items:flex-start;gap:10px');
    if (box) { box.style.left = '24px'; box.style.top = bottom ? 'auto' : '24px'; box.style.bottom = bottom ? '28px' : 'auto'; box.style.font = `600 14px ${th().body}`; }
    return box;
  }
  function faceEl(p) {
    const t = th(), w = document.createElement('div'); w.dataset.id = p.id;
    if (theme === 'paddock') { // Paddock : celui qui parle apparaît comme un message radio d'équipe, avec son onde
      w.style.cssText = `display:flex;align-items:center;gap:12px;background:rgba(5,5,6,.88);color:${t.text};border-left:4px solid ${t.accent};padding:10px 16px 10px 12px;transition:opacity .25s,transform .25s;opacity:0;transform:translateX(-8px)`;
      const r = document.createElement('span'); r.textContent = 'RADIO'; r.style.cssText = `font:500 12px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:${t.accent}`;
      const n = document.createElement('b'); n.textContent = p.self ? 'Toi' : p.name; n.style.fontSize = '15px';
      const wave = document.createElement('span'); wave.style.cssText = 'display:flex;align-items:center;gap:3px;height:20px';
      [0, .1, .2, .3, .15].forEach(dl => {
        const bar = document.createElement('i'); bar.style.cssText = `width:3px;height:100%;background:${t.text};transform-origin:center`; wave.append(bar);
        if (!calm()) bar.animate([{ transform: 'scaleY(.3)' }, { transform: 'scaleY(1)' }, { transform: 'scaleY(.3)' }], { duration: 600, delay: dl * 1000, iterations: Infinity, easing: 'ease-in-out' });
      });
      w.append(r, n, wave); return w;
    }
    w.style.cssText = `display:flex;align-items:center;gap:10px;background:${rgba(t.bg, .74)};color:${t.text};border-radius:99px;padding:6px 16px 6px 6px;transition:opacity .25s,transform .25s;opacity:0;transform:translateX(-8px)`;
    let pic;
    if (p.avatar) { pic = document.createElement('img'); pic.src = p.avatar; pic.alt = ''; pic.style.objectFit = 'cover'; }
    else { pic = document.createElement('div'); pic.textContent = (p.name || '?').charAt(0).toUpperCase(); pic.style.cssText = `display:grid;place-items:center;color:#fff;font-size:17px;font-weight:700;background:hsl(${colorOf(p.name)} 45% 40%)`; }
    pic.style.width = pic.style.height = '40px'; pic.style.borderRadius = '50%'; pic.style.flex = 'none';
    const lab = document.createElement('span'); lab.textContent = p.self ? 'Toi' : p.name;
    w.append(pic, lab);
    // Onde qui s'échappe de l'avatar, en boucle de 1,4 s tant qu'il parle (rien si « moins d'animations »)
    if (!calm()) pic.animate([{ boxShadow: `0 0 0 0 ${rgba(t.speaking, .6)}` }, { boxShadow: `0 0 0 12px ${rgba(t.speaking, 0)}`, offset: .7 }, { boxShadow: `0 0 0 0 ${rgba(t.speaking, 0)}` }], { duration: 1400, iterations: Infinity, easing: 'ease-out' });
    else pic.style.boxShadow = `0 0 0 3px ${t.speaking}`;
    return w;
  }
  function showFace(id, on) {
    if (on) speakingNow.add(id); else speakingNow.delete(id);
    const box = faceLayer(); if (!box) return;
    const p = roster.get(id); if (!p || p.self) return; // on n'affiche que les autres (on sait quand on parle soi-même)
    let el = box.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (on) {
      clearTimeout(speaking.get(id));
      if (!el) { el = faceEl(p); box.append(el); requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'none'; }); }
    } else if (el) {
      speaking.set(id, setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 260); }, 900));
    }
  }
  // Micro coupé : petite pastille pour le savoir même en plein écran.
  function renderMuted() {
    const box = faceLayer(); if (!box) return;
    const self = [...roster.values()].find(p => p.self);
    let pill = box.querySelector('[data-muted]');
    if (self && self.muted) {
      if (!pill) { pill = document.createElement('div'); pill.dataset.muted = '1'; pill.textContent = '🔇 Micro coupé'; pill.style.cssText = `color:${th().text};background:${rgba(th().bg, .8)};padding:5px 12px;border-radius:99px;font-size:12px`; box.prepend(pill); }
    } else pill?.remove();
  }
  function rebuildFaces() { const box = faceLayer(); if (!box) return; box.querySelectorAll('[data-id]').forEach(e => e.remove()); speakingNow.forEach(id => showFace(id, true)); renderMuted(); }
  function toast(text) { banner(text); }

  // ---------- Messages : en bas à droite, semi-transparents, ils glissent puis s'effacent (≈ 6 s) ----------
  function chatLayer() { return layer('cowatch-chat', 'right:24px;bottom:110px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:min(380px,40vw)'); }
  function showChat(name, text) {
    const box = chatLayer(); if (!box) return;
    const t = th(), p = [...roster.values()].find(x => x.name === name);
    const d = document.createElement('div');
    d.style.cssText = `color:${t.text};background:${rgba(t.bg, .62)};backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:8px 12px;border-radius:12px;font:14px/1.35 ${t.body};word-wrap:break-word;max-width:100%`;
    const b = document.createElement('b'); b.textContent = (p && p.self ? 'Toi' : name) + ' ';
    const x = document.createElement('span'); x.textContent = text;
    const sp = /^\/spoil\b\s*/i.exec(text); // spoil : flouté sur la vidéo aussi (on le lit en cliquant dans le panneau)
    d.append(b);
    if (sp) {
      x.textContent = text.slice(sp[0].length) || '…'; x.style.filter = 'blur(6px)';
      const g = document.createElement('em'); g.textContent = 'SPOIL';
      g.style.cssText = `font:700 10px ${t.body};font-style:normal;letter-spacing:.08em;color:#1A1206;background:${t.spoil || '#FFB547'};border-radius:4px;padding:1px 5px;margin-right:6px`;
      d.append(g);
    }
    d.append(x); box.append(d);
    if (!calm()) d.animate([{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: 'ease-out' });
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => { const f = d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500 }); f.onfinish = () => d.remove(); }, 6000);
  }

  // ---------- Zéro spoil : chacun voit une réaction quand ce moment arrive dans SA vidéo ----------
  // La réaction porte la position de la vidéo de celui qui l'envoie ; si ma vidéo est en retard, j'attends d'y être.
  function myPos() {
    if (!video) return null;
    if (mode === 'live') { const r = realPos(video); return r.how === 'aucune' ? null : { pos: r.pos, kind: 'real' }; }
    return { pos: video.currentTime, kind: 'media' };
  }
  function waitFor(m) { // millisecondes à attendre ; null = impossible de comparer
    const mine = myPos(); if (!mine || !Number.isFinite(m.pos) || mine.kind !== m.kind) return null;
    const ms = (m.pos - mine.pos) * 1000 / (video.playbackRate || 1);
    return ms > 20000 ? null : Math.max(0, ms); // plus de 20 s d'écart : pas le même moment, on ne compare pas
  }

  // ---------- Réactions v2 : elles montent sur la vidéo, avec le prénom ; le même émoji tapé plusieurs fois grossit (×N) ----------
  const groups = new Map(); // émoji -> bulle en cours
  const SIZES = [36, 52, 78]; // 1 réaction : petit · 2 : moyen · 3 et plus : grand (façon Messenger)
  function reactLayer() { return layer('cowatch-react', 'inset:0;overflow:hidden'); }
  function showReaction(name, emoji) {
    const box = reactLayer(); if (!box) return;
    if (theme === 'anime') notePeak(name); else if (theme === 'paddock') noteFlag(emoji);
    const t = th(), now = Date.now();
    let g = groups.get(emoji);
    if (g && now - g.last < 1500 && g.el.isConnected) { // même émoji en même temps : une seule bulle qui grossit
      g.count++; g.last = now; if (!g.names.includes(name)) g.names.push(name);
      if (g.count > 3) { rain(emoji); g.lab.textContent = g.names.length > 1 ? `${g.names[0]} +${g.names.length - 1} ×${g.count}` : `${name} ×${g.count}`; return; } // au-delà de 3 : pluie
    } else {
      if (box.childElementCount >= 14) box.firstElementChild.remove(); // avalanche : les plus anciennes laissent la place
      const el = document.createElement('div'); el.className = 'cw-rx';
      const x = 54 + Math.random() * 26; // partie droite de l'image, sans toucher le bord ni la languette
      el.style.cssText = `position:absolute;left:min(${x}%, calc(100% - 190px));bottom:120px;display:flex;flex-direction:column;align-items:center;gap:4px;will-change:transform,opacity`;
      const bub = document.createElement('div'); bub.className = 'cw-emoji'; bub.textContent = emoji;
      const lab = document.createElement('span'); lab.className = 'cw-who';
      lab.style.cssText = `background:${rgba(t.bg, .8)};color:${t.text};border-radius:99px;padding:2px 9px;font:700 12px ${t.body};white-space:nowrap`;
      el.append(bub, lab); box.append(el);
      g = { el, bub, lab, count: 1, names: [name], last: now, dx: (Math.random() - .5) * 90 };
      groups.set(emoji, g);
    }
    const size = SIZES[Math.min(g.count, 3) - 1], hue = colorOf(g.names[0]);
    g.bub.style.cssText = `font-size:${size}px;line-height:1;width:${size * 1.4}px;height:${size * 1.4}px;display:grid;place-items:center;border-radius:50%;background:${rgba(t.bg, .55)};box-shadow:0 0 0 3px hsl(${hue},75%,58%),0 4px 14px rgba(0,0,0,.4);transition:font-size .2s,width .2s,height .2s`;
    g.lab.textContent = g.names.length > 1 ? `${g.names[0]} +${g.names.length - 1}${g.count > g.names.length ? ` ×${g.count}` : ''}` : g.count > 1 ? `${name} ×${g.count}` : name;
    // Montée de ≈ 210 px en ≈ 3 s, fondu en fin de course ; relancée à chaque nouvelle réaction identique.
    g.anim?.cancel();
    const rise = 200 + Math.random() * 20, dx = g.dx;
    g.anim = calm()
      ? g.el.animate([{ opacity: 1 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: 2500 })
      : g.el.animate([
        { transform: 'translate(0,0) scale(.6)', opacity: 0 },
        { transform: `translate(${dx * .3}px,-30px) scale(${g.count > 1 ? 1.15 : 1.05})`, opacity: 1, offset: .12 },
        { transform: `translate(${dx * .7}px,-${rise * .65}px) scale(1)`, opacity: 1, offset: .7 },
        { transform: `translate(${dx}px,-${rise}px) scale(1)`, opacity: 0 },
      ], { duration: 3000, easing: 'ease-out' });
    const anim = g.anim, el = g.el;
    anim.onfinish = () => { el.remove(); if (groups.get(emoji)?.el === el) groups.delete(emoji); };
  }
  // Pluie : quelques petits émojis tombent du haut de l'image, dispersés, puis s'effacent (40 au maximum à l'écran).
  function rain(emoji) {
    const box = layer('cowatch-rain', 'inset:0;overflow:hidden'); if (!box) return;
    const n = 6 + Math.floor(Math.random() * 4);
    // La pluie tombe dans l'image (pas au-dessus) : on prend le cadre de la vidéo quand on le connaît.
    const r = video && video.isConnected ? video.getBoundingClientRect() : null, top = r && r.height > 100 ? Math.max(0, r.top) : 0, left = r && r.width > 100 ? Math.max(0, r.left) : 0, width = r && r.width > 100 ? Math.min(innerWidth, r.width) : innerWidth;
    for (let i = 0; i < n; i++) {
      if (box.childElementCount >= 60) box.firstElementChild.remove();
      const d = document.createElement('span'); d.className = 'cw-drop'; d.textContent = emoji;
      const size = 22 + Math.random() * 14, x = left + width * (.06 + Math.random() * .88);
      d.style.cssText = `position:absolute;left:${x}px;top:${top - 30}px;font-size:${size}px;line-height:1;will-change:transform,opacity;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))`;
      box.append(d);
      const fall = (r && r.height > 100 ? r.height : innerHeight) * (.6 + Math.random() * .35), sway = (Math.random() - .5) * 80, delay = Math.random() * 600;
      const a = calm()
        ? d.animate([{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 0 }], { duration: 1600, delay })
        : d.animate([{ transform: 'translate(0,0) rotate(0deg)', opacity: 0 }, { opacity: 1, offset: .12 }, { transform: `translate(${sway}px,${fall}px) rotate(${(Math.random() - .5) * 60}deg)`, opacity: 0 }], { duration: 2200 + Math.random() * 1200, delay, easing: 'cubic-bezier(.3,.6,.6,1)' });
      a.onfinish = () => d.remove();
    }
  }
  // ---------- Anime : PEAK, quand tout le monde réagit en même temps (une fois, lignes de vitesse 0,6 s) ----------
  const peakSeen = new Map(); let peakAt = 0;
  function notePeak(name) {
    const now = Date.now(); peakSeen.set(name, now);
    for (const [k, v] of peakSeen) if (now - v > 3000) peakSeen.delete(k);
    const need = Math.max(2, roster.size || 0);
    if (peakSeen.size < need || now - peakAt < 30000) return;
    peakAt = now; peakSeen.clear(); showPeak();
  }
  function showPeak() {
    const box = layer('cowatch-peak', 'inset:0;display:grid;place-items:center;overflow:hidden'); if (!box) return;
    const t = th(); box.replaceChildren();
    const lines = document.createElement('div');
    lines.style.cssText = `position:absolute;inset:-20%;background:repeating-conic-gradient(from 0deg at 50% 50%, ${rgba(t.text, .16)} 0deg 1.2deg, transparent 1.2deg 9deg);-webkit-mask:radial-gradient(circle, transparent 22%, #000 60%);mask:radial-gradient(circle, transparent 22%, #000 60%)`;
    const word = document.createElement('div'); word.textContent = 'PEAK';
    word.style.cssText = `position:relative;font:800 min(18vw,170px)/1 ${t.display};letter-spacing:.04em;color:${t.accent};text-shadow:0 6px 40px rgba(0,0,0,.6)`;
    box.append(lines, word);
    if (calm()) { setTimeout(() => box.replaceChildren(), 1500); return; }
    lines.animate([{ opacity: 0, transform: 'scale(1.15)' }, { opacity: 1, transform: 'scale(1)', offset: .25 }, { opacity: 0, transform: 'scale(.95)' }], { duration: 600, easing: 'ease-out' });
    const a = word.animate([{ opacity: 0, transform: 'scale(.6) skewX(-10deg)' }, { opacity: 1, transform: 'scale(1.05) skewX(-10deg)', offset: .2 }, { opacity: 1, transform: 'scale(1) skewX(-10deg)', offset: .75 }, { opacity: 0, transform: 'scale(1.1) skewX(-10deg)' }], { duration: 1400, easing: 'ease-out' });
    a.onfinish = () => box.replaceChildren();
  }

  // ---------- Paddock : moments drapeau en bandeau, et feux de départ ----------
  const flagAt = {};
  function noteFlag(emoji) {
    const kind = emoji === '🏁' ? 'damier' : emoji === '🟡' ? 'jaune' : null; if (!kind) return;
    const now = Date.now(); if (now - (flagAt[kind] || 0) < 8000) return; flagAt[kind] = now;
    const box = layer('cowatch-flag', 'left:0;right:0;top:0;display:flex;justify-content:center'); if (!box) return;
    const t = th(), band = document.createElement('div');
    const lab = document.createElement('span'); lab.textContent = kind === 'damier' ? 'Drapeau à damier' : 'Drapeau jaune';
    lab.style.cssText = `display:inline-block;font:900 26px ${t.display};text-transform:uppercase;letter-spacing:.04em;transform:skewX(-8deg);padding:4px 18px;` + (kind === 'damier' ? `background:${t.bg};color:${t.text}` : `color:${t.accentInk}`);
    band.style.cssText = 'width:100%;display:flex;justify-content:center;align-items:center;padding:6px 0;' + (kind === 'damier'
      ? 'background:conic-gradient(#F4F4F2 25%, #0D0E10 0 50%, #F4F4F2 0 75%, #0D0E10 0) 0 0/24px 24px'
      : `background:${t.accent}`);
    band.append(lab); box.replaceChildren(band);
    const show = calm() ? null : band.animate([{ transform: 'translateY(-100%)' }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
    setTimeout(() => { if (box.firstChild !== band) return; const f = calm() ? null : band.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400 }); if (f) f.onfinish = () => band.remove(); else band.remove(); }, 3000);
  }
  function onLights(m) {
    if (theme !== 'paddock') return;
    const ms = waitFor(m); setTimeout(showLights, ms || 0);
  }
  function showLights() {
    const box = layer('cowatch-lights', 'inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px'); if (!box) return;
    const t = th(); box.replaceChildren();
    const rack = document.createElement('div'); rack.style.cssText = 'display:flex;gap:18px;background:rgba(5,5,6,.9);border-radius:14px;padding:18px 24px';
    const lamps = [0, 1, 2, 3, 4].map(() => { const l = document.createElement('span'); l.style.cssText = 'width:min(62px,7vw);height:min(62px,7vw);border-radius:50%;background:#3A1214'; rack.append(l); return l; });
    const go = document.createElement('div'); go.textContent = 'Extinction des feux !';
    go.style.cssText = `font:900 min(9vw,120px)/0.9 ${t.display};text-transform:uppercase;color:${t.text};text-shadow:0 8px 40px rgba(0,0,0,.6);transform:skewX(-8deg);opacity:0;text-align:center;white-space:nowrap`;
    box.append(rack, go);
    const fit = () => { const w = go.scrollWidth, max = box.clientWidth * .92; if (w > max) go.style.fontSize = `${parseFloat(getComputedStyle(go).fontSize) * max / w}px`; };
    fit(); document.fonts?.ready.then(fit);
    lamps.forEach((l, i) => setTimeout(() => { l.style.background = '#E5262B'; l.style.boxShadow = '0 0 22px rgba(229,38,43,.9)'; }, i * 1000));
    setTimeout(() => { // feux éteints : c'est parti
      lamps.forEach(l => { l.style.background = '#3A1214'; l.style.boxShadow = 'none'; });
      go.style.opacity = '1';
      if (!calm()) go.animate([{ opacity: 0, transform: 'skewX(-8deg) translateX(-60px)' }, { opacity: 1, transform: 'skewX(-8deg) translateX(0)' }], { duration: 250, easing: 'cubic-bezier(.2,.9,.3,1)' });
      setTimeout(() => box.replaceChildren(), 1800);
    }, 5000 + 600);
  }
  function onReaction(m) {
    const ms = waitFor(m);
    if (ms) setTimeout(() => showReaction(m.name, m.emoji), ms); else showReaction(m.name, m.emoji);
  }

  // ---------- Vestiaire : le BUUUT ----------
  // Un seul par but (le serveur filtre 20 s), affiché quand le but arrive dans MA vidéo, jamais avant.
  // Dans le doute (positions impossibles à comparer en direct), on n'affiche rien plutôt que de spoiler.
  const goals = new Map(); // id -> {timer, shownAt}
  function onGoal(m) {
    if (calm()) return; // « moins d'animations » : pas de BUUUT
    const ms = waitFor(m);
    if (ms == null && mode === 'live') return;
    const g = { timer: setTimeout(() => { g.timer = null; showGoal(m); g.shownAt = Date.now(); }, ms || 0) };
    goals.set(m.id, g);
  }
  function onGoalCancel(m) {
    const g = goals.get(m.id); if (!g) return;
    if (g.timer) { clearTimeout(g.timer); goals.delete(m.id); return; } // pas encore vu : on ne montre rien
    layers['cowatch-buuut']?.replaceChildren();
    banner('But refusé (VAR). Lâche pas !');
  }
  function showGoal(m) {
    const box = layer('cowatch-buuut', 'inset:0;display:flex;align-items:center;justify-content:center'); if (!box) return;
    loadFonts(); box.replaceChildren();
    const t = th();
    const flash = document.createElement('div');
    flash.style.cssText = `position:absolute;inset:0;background:radial-gradient(55% 45% at 50% 50%, ${rgba(t.text, .22)} 0%, ${rgba(t.text, 0)} 70%)`;
    const wrap = document.createElement('div'); wrap.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;gap:6px';
    const big = document.createElement('span'); big.textContent = 'Buuut';
    big.style.cssText = `font:800 min(24vh,240px)/.8 ${t.display};text-transform:uppercase;letter-spacing:.01em;background:linear-gradient(180deg,#FFFFFF 0%,#B9C1D3 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:3px rgba(6,10,28,.55);paint-order:stroke fill;filter:drop-shadow(0 6px 24px rgba(0,0,0,.6))`;
    const who = document.createElement('span'); who.textContent = `${m.by} l'a crié en premier`;
    who.style.cssText = `font:600 min(2.6vh,22px) ${t.body};color:${t.text};text-shadow:0 2px 8px rgba(0,0,0,.6)`;
    wrap.append(big, who); box.append(flash, wrap);
    // Entrée 0,3 s avec léger rebond, tient ≈ 1 s, s'éteint.
    flash.style.opacity = wrap.style.opacity = '0'; // état final : invisible (même si l'animation est interrompue)
    flash.animate([{ opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: .6, offset: .7 }, { opacity: 0 }], { duration: 1800 });
    wrap.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.08)', offset: .17 }, { transform: 'scale(1)', offset: .25 }, { opacity: 1, transform: 'scale(1)', offset: .78 }, { opacity: 0, transform: 'scale(1.03)' }], { duration: 1800, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    clearTimeout(box._t); box._t = setTimeout(() => box.replaceChildren(), 1900); // retiré à coup sûr, même si le plein écran change entre-temps
  }

  // ---------- Vestiaire : prono du groupe en haut à gauche ----------
  // Volet sur le bord gauche, à mi-hauteur (loin du score et du chrono, en haut de l'image) :
  // replié, il montre le score le plus choisi ; au survol, il déroule le prono de chacun.
  let pronoOpen = false;
  function renderProno() {
    const box = layer('cowatch-prono', 'left:0;top:34%'); if (!box) return;
    if (theme !== 'vestiaire' || !inRoom || !pronos.length) { box.replaceChildren(); box.style.display = 'none'; return; }
    loadFonts();
    const t = th(), tally = {}; for (const p of pronos) tally[p.score] = (tally[p.score] || 0) + 1;
    const [score, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    box.style.display = 'flex';
    if (!box.dataset.wired) {
      box.dataset.wired = '1';
      box.addEventListener('mouseenter', () => { pronoOpen = true; renderProno(); });
      box.addEventListener('mouseleave', () => { pronoOpen = false; renderProno(); });
    }
    box.style.pointerEvents = 'auto'; box.style.cursor = 'default';
    box.style.flexDirection = 'column'; box.style.gap = '4px';
    box.style.background = rgba(t.bg, .8); box.style.color = t.text; box.style.border = `1px solid ${rgba(t.muted, .22)}`; box.style.borderLeft = '0';
    box.style.borderRadius = '0 12px 12px 0'; box.style.padding = pronoOpen ? '10px 14px' : '8px 10px 8px 9px'; box.style.boxShadow = '0 6px 20px rgba(0,0,0,.35)';
    const k = document.createElement('span'); k.textContent = pronoOpen ? 'Prono du groupe' : 'Prono'; k.style.cssText = `font:700 10px ${t.display};letter-spacing:.18em;text-transform:uppercase;color:${t.muted}`;
    const sc = document.createElement('span'); sc.textContent = score; sc.style.cssText = `font:800 ${pronoOpen ? 24 : 20}px/1 ${t.display}`;
    const parts = [k, sc];
    if (pronoOpen) {
      const sub = document.createElement('span'); sub.textContent = n > 1 ? `${n} sur ${pronos.length}` : `${pronos.length} prono${pronos.length > 1 ? 's' : ''}`; sub.style.cssText = `font:12px ${t.body};color:${t.muted}`;
      parts.push(sub);
      for (const p of pronos) {
        const row = document.createElement('div'); row.style.cssText = `display:flex;justify-content:space-between;gap:14px;font:600 13px ${t.body}`;
        const nm = document.createElement('span'); nm.textContent = p.name; const v = document.createElement('b'); v.textContent = p.score; v.style.fontFamily = t.display;
        row.append(nm, v); parts.push(row);
      }
    } else if (pronos.length > 1) { const sub = document.createElement('span'); sub.textContent = `×${pronos.length}`; sub.style.cssText = `font:11px ${t.body};color:${t.muted}`; parts.push(sub); }
    box.replaceChildren(...parts);
  }

  // ---------- Barre d'émojis du plein écran : en bas au centre, visible quand on bouge la souris ----------
  let barTimer = null;
  function renderBar(show) {
    const box = layer('cowatch-bar', 'left:50%;bottom:110px;transform:translateX(-50%)'); if (!box) return;
    if (!inRoom || !(isFs() || !panelOpen)) { box.replaceChildren(); return; } // plein écran du site, ou panneau replié
    const t = th();
    if (box.dataset.theme !== theme || !box.childElementCount) {
      box.dataset.theme = theme; box.replaceChildren();
      box.style.cssText += `;pointer-events:auto;display:flex;gap:6px;background:${rgba(t.bg, .74)};border:1px solid ${rgba(t.muted, .22)};border-radius:14px;padding:6px 10px;transition:opacity .3s`;
      t.emojis.forEach((em, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = em; b.setAttribute('aria-label', `Réaction ${t.labels[i] || em}`);
        b.style.cssText = 'width:44px;height:44px;border-radius:50%;border:0;background:transparent;font-size:24px;cursor:pointer;padding:0;line-height:1';
        b.onclick = e => { e.stopPropagation(); chrome.runtime.sendMessage({ to: 'engine', cmd: 'reaction', emoji: em }).catch(() => {}); if (!calm()) b.animate([{ transform: 'scale(.85)' }, { transform: 'scale(1)' }], { duration: 160 }); };
        box.append(b);
      });
    }
    if (show) { box.style.opacity = '1'; box.style.pointerEvents = 'auto'; clearTimeout(barTimer); barTimer = setTimeout(() => { box.style.opacity = '0'; box.style.pointerEvents = 'none'; }, 3000); }
  }
  document.addEventListener('mousemove', () => { if (inRoom && (isFs() || !panelOpen) && isDisplayFrame()) renderBar(true); }, { passive: true });

  // ---------- Languette « Cowatch » sur le bord droit : rouvre le panneau, visible aussi en plein écran ----------
  let inRoom = false, panelOpen = true, unread = 0, reopenEl = null, lastNudge = 0;
  // Récap de fin de match sur la vidéo : carte au centre, 15 s (un clic la ferme). Le détail reste dans le panneau.
  function showRecap(r) {
    if (!r || Date.now() - r.at > 60000) return;
    const box = layer('cowatch-recap', 'left:50%;top:16%;transform:translateX(-50%);pointer-events:auto;cursor:pointer'); if (!box) return;
    const t = th(), vest = theme === 'vestiaire';
    const fp = (k, p) => k === 'real' ? new Date(p * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `${Math.floor(p / 60)}'`;
    box.style.cssText += `;min-width:280px;max-width:min(420px,80vw);background:${rgba(t.bg, .9)};color:${t.text};border:1px solid ${rgba(t.text, .18)};border-radius:16px;padding:16px 20px;font:500 14px ${t.body};box-shadow:0 18px 50px rgba(0,0,0,.5)`;
    box.textContent = '';
    const row = (a, b, big) => { const d = document.createElement('div'); d.style.cssText = `display:flex;justify-content:space-between;gap:16px;${big ? `font:800 30px ${t.display};letter-spacing:.04em;margin:2px 0 8px` : 'margin-top:4px'}`; const x = document.createElement('span'); x.textContent = a; const y = document.createElement('span'); y.textContent = b; d.append(x, y); box.append(d); };
    const head = document.createElement('div'); head.textContent = vest ? 'RÉCAP DU MATCH' : 'RÉCAP DE LA SÉANCE'; head.style.cssText = `font:700 12px ${t.display};letter-spacing:.18em;opacity:.75`; box.append(head);
    if (r.score) row('Score final', r.score, true);
    const win = r.pronos.filter(p => p.res === 'exact'), good = r.pronos.filter(p => p.res === 'bon');
    if (win.length) row('🎯 Dans le mille', win.map(p => p.name).join(', '));
    if (good.length) row('✓ Bon vainqueur', good.map(p => p.name).join(', '));
    if (r.score && r.pronos.length && !win.length && !good.length) row('Pronos', 'personne n\'a vu juste');
    for (const m of r.moments) row(`Moment fort · ${fp(m.kind, m.pos)}`, `${m.emoji} · ${m.n} réactions`);
    box.style.display = 'block'; box.style.opacity = '1';
    box.onclick = e => { e.stopPropagation(); box.style.display = 'none'; };
    clearTimeout(box._t); box._t = setTimeout(() => { box.style.display = 'none'; }, 15000);
  }
  function renderReopen(nudge) {
    const show = inRoom && isDisplayFrame() && (isFs() || !panelOpen);
    if (!show) { reopenEl?.remove(); return; }
    const t = th();
    if (!reopenEl) {
      reopenEl = mine(document.createElement('button')); reopenEl.id = 'cowatch-reopen'; reopenEl.type = 'button';
      reopenEl.onclick = async e => {
        e.stopPropagation();
        uiTouchAt = Date.now();
        if (isFs()) await (document.exitFullscreen?.() || Promise.resolve()).catch(() => {}); // le panneau ne s'affiche pas en plein écran
        uiTouchAt = Date.now(); // certains lecteurs se mettent en pause en sortant du plein écran ou quand le panneau s'ouvre
        const r = await chrome.runtime.sendMessage({ cmd: 'openPanel' }).catch(() => null);
        uiTouchAt = Date.now();
        if (r && r.ok) { panelOpen = true; unread = 0; renderReopen(); }
      };
    }
    reopenEl.style.cssText = `position:fixed;right:0;top:calc(50% - 44px);width:40px;height:88px;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:${rgba(t.bg, .82)};color:${t.text};border:1px solid ${rgba(t.muted, .22)};border-right:0;border-radius:12px 0 0 12px;cursor:pointer;padding:0;box-shadow:0 6px 20px rgba(0,0,0,.35)`;
    reopenEl.setAttribute('aria-label', unread ? `Rouvrir le chat Cowatch, ${unread} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}` : 'Rouvrir le chat Cowatch');
    reopenEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"></path></svg>';
    const lab = document.createElement('span'); lab.className = 'sr'; lab.textContent = 'Cowatch'; lab.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)'; reopenEl.append(lab);
    if (unread) { const n = document.createElement('span'); n.textContent = unread > 9 ? '9+' : String(unread); n.style.cssText = `background:${t.accent};color:${t.accentInk};border-radius:99px;padding:1px 6px;font:700 11px system-ui`; reopenEl.append(n); }
    const par = layerParent(); if (reopenEl.parentNode !== par) par.append(reopenEl);
    // Petit coup d'épaule quand un message arrive, jamais plus d'une fois toutes les 5 s.
    if (nudge === 'msg' && !calm() && Date.now() - lastNudge > 5000) { lastNudge = Date.now(); reopenEl.animate([{ transform: 'none' }, { transform: 'translateX(-8px)' }, { transform: 'none' }], { duration: 400, easing: 'ease-in-out' }); }
  }

  function setTheme(id) {
    if (!id || id === theme || (TT && !TT.valid(id))) return;
    theme = id; loadFonts();
    for (const k of ['cowatch-bar']) { if (layers[k]) layers[k].dataset.theme = ''; }
    rebuildFaces(); renderProno(); renderBar(false); renderReopen();
  }
  document.addEventListener('fullscreenchange', () => {
    for (const id of Object.keys(layers)) if (!isDisplayFrame()) layers[id].remove(); else layer(id, '');
    rebuildFaces(); renderProno(); renderBar(true); renderReopen();
  });

  // Position de ma vidéo envoyée au moteur chaque seconde : mes réactions portent ce repère (zéro spoil chez les autres).
  setInterval(() => { if (inRoom && video && window.top === window || (inRoom && video && isDisplayFrame())) { const p = myPos(); if (p) chrome.runtime.sendMessage({ cmd: 'pos', ...p, playing: !video.paused }).catch(() => {}); } }, 1000);

  if (window.top !== window) chrome.runtime.sendMessage({ cmd: 'panelState' }).then(r => { if (r && typeof r.open === 'boolean') { panelOpen = r.open; renderReopen(); } }).catch(() => {});
  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m.t === 'has-video') { if (video) reply(true); return; } // le panneau suit l'onglet où il y a une vidéo
    if (m.t === 'panel') { if (!!m.open === panelOpen && !m.force) return; panelOpen = !!m.open; if (panelOpen && !isFs()) unread = 0; renderReopen(); renderBar(!panelOpen); return; }
    if (m.t === 'roster') { roster = new Map(m.people.map(p => [p.id, p])); pronos = m.pronos || []; if (m.theme) setTheme(m.theme); renderMuted(); renderProno(); return; }
    if (m.t === 'speak') { showFace(m.id, m.on); return; }
    if (m.t === 'toast') { toast(m.text); return; }
    if (m.t === 'diag') { diagnose().then(d => chrome.runtime.sendMessage({ cmd: 'diag', data: d }).catch(() => {})); return; }
    if (m.t === 'ping-video') { if (video) chrome.runtime.sendMessage({ cmd: 'video', found: true }).catch(() => {}); return; }
    if (m.t === 'welcome') { lastKind = null; if (video) chrome.runtime.sendMessage({ cmd: 'site', host: location.hostname }).catch(() => {}); inRoom = true; if (m.theme) setTheme(m.theme); loadFonts(); renderReopen(); renderProno(); mode = m.mode || 'vod'; me = m.id; host = m.host || m.id; offset = m.offset || 0; startStateLoop(); if (video) banner(isHost() ? 'Salon connecté — tu pilotes la lecture' : 'Salon connecté — calage sur le pilote…'); }
    else if (m.t === 'host') { host = m.id; startStateLoop(); }
    else if (m.t === 'state-request') emit(video && !video.paused ? 'state' : 'pause');
    else if (m.t === 'sync') { apply(m); if (m.action !== 'state') banner(`${m.name} : ${{ play: '▶ lecture', pause: '⏸ pause', seek: '⏩ avance' }[m.action] || m.action}`); }
    else if (m.t === 'reaction') onReaction(m);
    else if (m.t === 'lights') onLights(m);
    else if (m.t === 'goal') onGoal(m);
    else if (m.t === 'goal-cancel') onGoalCancel(m);
    else if (m.t === 'theme') setTheme(m.theme);
    else if (m.t === 'recap') showRecap(m);
    else if (m.t === 'chat') { showChat(m.name, m.text); if (!panelOpen || isFs()) { unread++; renderReopen('msg'); } }
    else if (m.t === 'mode') { mode = m.mode; banner(mode === 'live' ? 'Mode match : alignement sur le plus lent' : 'Mode série : lecture partagée'); }
    else if (m.t === 'align') align(m.pauseFor, m.auto);
    else if (m.t === 'disconnected') { me = null; inRoom = false; renderReopen(); renderProno(); renderBar(false); if (!m.quiet) banner('Cowatch déconnecté'); }
  });
})();
