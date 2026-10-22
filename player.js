// Content script : repère la vidéo principale de la page et applique / émet les commandes de lecture.
(() => {
  if (window.__salonSync) return; window.__salonSync = true;
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
  function findVideo() {
    const vids = allVideos().filter(v => v.readyState > 0 || v.src || v.currentSrc);
    // Prime Video garde deux vidéos de même taille (pub + programme) : à taille égale, celle qui joue, puis la plus longue.
    const area = v => Math.round(v.clientWidth * v.clientHeight / 1000), len = v => isFinite(v.duration) ? v.duration : 1e9;
    vids.sort((a, b) => area(b) - area(a) || (a.paused - b.paused) || len(b) - len(a));
    return vids[0] || null;
  }
  function attach(v) {
    if (!v || v === video) return;
    video = v;
    chrome.runtime.sendMessage({ cmd: 'video', found: true }).catch(() => {});
    for (const ev of ['play', 'pause', 'seeked']) v.addEventListener(ev, () => {
      if (Date.now() < ignoreUntil || !me || mode !== 'vod') return; // en direct, chacun garde son flux
      emit(ev === 'seeked' ? 'seek' : ev);
    });
  }
  function emit(action) {
    if (!video) return;
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
    if (me && video && mode === 'live' && lastKind && ++clockTick % 2 === 0) {
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
    b.style.cssText = 'position:fixed;right:20px;bottom:24px;z-index:2147483647;background:#F4F6FA;color:#060A1C;border:0;border-radius:999px;padding:12px 18px;font:700 14px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer';
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
    if (!video || mode !== 'vod') return;
    const now = Date.now() + offset;
    const target = m.time + (m.playing ? Math.max(0, now - m.sentAt) / 1000 * (m.rate || 1) : 0);
    const drift = video.currentTime - target;
    if (m.action === 'state' && Math.abs(drift) < DRIFT && video.paused === !m.playing) return;
    quiet();
    if (Math.abs(drift) > (m.action === 'state' ? DRIFT : 0.3)) seekTo(target);
    if (m.playing && video.paused) { try { await video.play(); } catch { banner('Clique sur ▶ pour rejoindre la lecture'); } }
    if (!m.playing && !video.paused) video.pause();
  }

  // Alignement en direct : on se met en pause le temps de son avance, puis on relance.
  // Fonctionne si le lecteur autorise la pause du direct (Canal+ : "contrôle du direct", à vérifier sur chaque chaîne).
  // Calage du direct :
  //  - en avance de plus de 3 s : pause le temps de l'avance, puis reprise ;
  //  - en avance de 3 s ou moins : léger ralenti (0,75×), presque invisible, sans figer l'image ;
  //  - en retard (sec < 0) : on avance d'autant (le lecteur d'en face ne peut pas prendre plus de retard).
  function align(sec, auto) {
    if (!video || !sec) return;
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
    quiet(sec * 1000 + 1500);
    video.pause();
    banner(auto ? `Calage avec le salon… (${sec.toFixed(1)} s)` : `Alignement : pause ${sec.toFixed(1)} s`);
    alignTimer = setTimeout(async () => { quiet(); try { await video.play(); banner('Calé ✓'); } catch { banner('Clique sur ▶ pour reprendre'); } }, sec * 1000);
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
    if (!el) { el = layers[id] = document.createElement('div'); el.id = id; el.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;' + css; }
    const par = layerParent(); if (el.parentNode !== par) par.append(el);
    return el;
  }
  // Polices du Vestiaire, fournies avec l'extension (chargées en mémoire : la page ne peut pas les bloquer).
  const fontsDone = new Set();
  function loadFonts() {
    if (theme !== 'vestiaire' || fontsDone.has(theme)) return; fontsDone.add(theme);
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
    const bottom = theme === 'vestiaire';
    const box = layer('cowatch-faces', 'display:flex;flex-direction:column;align-items:flex-start;gap:10px');
    if (box) { box.style.left = '24px'; box.style.top = bottom ? 'auto' : '24px'; box.style.bottom = bottom ? '28px' : 'auto'; box.style.font = `600 14px ${th().body}`; }
    return box;
  }
  function faceEl(p) {
    const t = th(), w = document.createElement('div'); w.dataset.id = p.id;
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
    d.append(b, x); box.append(d);
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
    const t = th(), now = Date.now();
    let g = groups.get(emoji);
    if (g && now - g.last < 1500 && g.el.isConnected) { // même émoji en même temps : une seule bulle qui grossit
      g.count++; g.last = now; if (!g.names.includes(name)) g.names.push(name);
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
  function renderProno() {
    const box = layer('cowatch-prono', 'top:24px;left:24px'); if (!box) return;
    if (theme !== 'vestiaire' || !inRoom || !pronos.length) { box.replaceChildren(); return; }
    loadFonts();
    const t = th(), tally = {}; for (const p of pronos) tally[p.score] = (tally[p.score] || 0) + 1;
    const [score, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    box.style.cssText += `;background:${rgba(t.bg, .74)};border:1px solid ${rgba(t.muted, .22)};border-radius:12px;padding:10px 14px;color:${t.text};display:flex;flex-direction:column;gap:4px`;
    const k = document.createElement('span'); k.textContent = 'Prono du groupe'; k.style.cssText = `font:700 11px ${t.display};letter-spacing:.2em;text-transform:uppercase;color:${t.muted}`;
    const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:baseline;gap:8px';
    const sc = document.createElement('span'); sc.textContent = score; sc.style.cssText = `font:800 28px/1 ${t.display}`;
    const sub = document.createElement('span'); sub.textContent = pronos.length === 1 ? `${pronos[0].name}` : n > 1 ? `${n} sur ${pronos.length}` : `${pronos.length} pronos`; sub.style.cssText = `font:12px ${t.body};color:${t.muted}`;
    row.append(sc, sub); box.replaceChildren(k, row);
  }

  // ---------- Barre d'émojis du plein écran : en bas au centre, visible quand on bouge la souris ----------
  let barTimer = null;
  function renderBar(show) {
    const box = layer('cowatch-bar', 'left:50%;bottom:110px;transform:translateX(-50%)'); if (!box) return;
    if (!inRoom || !isFs()) { box.replaceChildren(); return; }
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
  document.addEventListener('mousemove', () => { if (inRoom && isFs() && isDisplayFrame()) { renderBar(true); renderReopen(true); } }, { passive: true });

  // ---------- Languette « Cowatch » sur le bord droit : rouvre le panneau, visible aussi en plein écran ----------
  let inRoom = false, panelOpen = true, unread = 0, reopenEl = null, lastNudge = 0;
  function renderReopen(nudge) {
    const show = inRoom && isDisplayFrame() && (isFs() || !panelOpen);
    if (!show) { reopenEl?.remove(); return; }
    const t = th();
    if (!reopenEl) {
      reopenEl = document.createElement('button'); reopenEl.id = 'cowatch-reopen'; reopenEl.type = 'button';
      reopenEl.onclick = async e => {
        e.stopPropagation();
        if (isFs()) await (document.exitFullscreen?.() || Promise.resolve()).catch(() => {}); // le panneau ne s'affiche pas en plein écran
        const r = await chrome.runtime.sendMessage({ cmd: 'openPanel' }).catch(() => null);
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
  chrome.runtime.onMessage.addListener(m => {
    if (m.t === 'panel') { panelOpen = !!m.open; if (panelOpen && !isFs()) unread = 0; renderReopen(); return; }
    if (m.t === 'roster') { roster = new Map(m.people.map(p => [p.id, p])); pronos = m.pronos || []; if (m.theme) setTheme(m.theme); renderMuted(); renderProno(); return; }
    if (m.t === 'speak') { showFace(m.id, m.on); return; }
    if (m.t === 'toast') { toast(m.text); return; }
    if (m.t === 'diag') { diagnose().then(d => chrome.runtime.sendMessage({ cmd: 'diag', data: d }).catch(() => {})); return; }
    if (m.t === 'ping-video') { if (video) chrome.runtime.sendMessage({ cmd: 'video', found: true }).catch(() => {}); return; }
    if (m.t === 'welcome') { inRoom = true; if (m.theme) setTheme(m.theme); loadFonts(); renderReopen(); renderProno(); mode = m.mode || 'vod'; me = m.id; host = m.host || m.id; offset = m.offset || 0; startStateLoop(); if (video) banner(isHost() ? 'Salon connecté — tu pilotes la lecture' : 'Salon connecté — calage sur le pilote…'); }
    else if (m.t === 'host') { host = m.id; startStateLoop(); }
    else if (m.t === 'state-request') emit(video && !video.paused ? 'state' : 'pause');
    else if (m.t === 'sync') { apply(m); if (m.action !== 'state') banner(`${m.name} : ${{ play: '▶ lecture', pause: '⏸ pause', seek: '⏩ avance' }[m.action] || m.action}`); }
    else if (m.t === 'reaction') onReaction(m);
    else if (m.t === 'goal') onGoal(m);
    else if (m.t === 'goal-cancel') onGoalCancel(m);
    else if (m.t === 'theme') setTheme(m.theme);
    else if (m.t === 'chat') { showChat(m.name, m.text); if (!panelOpen || isFs()) { unread++; renderReopen('msg'); } }
    else if (m.t === 'mode') { mode = m.mode; banner(mode === 'live' ? 'Mode match : alignement sur le plus lent' : 'Mode série : lecture partagée'); }
    else if (m.t === 'align') align(m.pauseFor, m.auto);
    else if (m.t === 'disconnected') { me = null; inRoom = false; renderReopen(); renderProno(); renderBar(false); banner('Cowatch déconnecté'); }
  });
})();
