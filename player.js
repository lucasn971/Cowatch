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
    b.style.cssText = 'position:fixed;right:20px;bottom:24px;z-index:2147483647;background:#ff5a3c;color:#fff;border:0;border-radius:999px;padding:12px 18px;font:600 14px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer';
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

  let bannerEl;
  // En plein écran, seul l'élément affiché en plein écran est visible : on y place nos calques.
  function layerParent() { const f = document.fullscreenElement || document.webkitFullscreenElement; return f && f.tagName !== 'VIDEO' && f.tagName !== 'IFRAME' ? f : document.documentElement; }
  // Qui dessine les visages et les messages ? La page, sauf quand le plein écran du site se fait dans un lecteur intégré
  // (iframe, comme TF1 ou Canal+) : c'est alors ce lecteur, seul visible, qui les affiche.
  function isDisplayFrame() {
    const f = document.fullscreenElement || document.webkitFullscreenElement;
    if (f && f.tagName !== 'IFRAME') return true;
    if (window.top !== window) return false;
    return !(f && f.tagName === 'IFRAME');
  }
  function banner(txt) {
    if (!isDisplayFrame()) return;
    bannerEl = bannerEl || Object.assign(document.createElement('div'), { style: 'position:fixed;top:14px;left:50%;transform:translateX(-50%);max-width:70vw;z-index:2147483647;background:#ff5a3c;color:#fff;font:600 13px system-ui;padding:8px 12px;border-radius:8px;pointer-events:none' });
    bannerEl.textContent = txt; layerParent().append(bannerEl);
    clearTimeout(bannerEl._t); bannerEl._t = setTimeout(() => bannerEl.remove(), 3500);
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

  // ---------- Visages : photo de celui qui parle, en haut à droite de la vidéo ----------
  let roster = new Map(), faceBox = null, chatBox = null;
  const speaking = new Map(); // id -> timer de disparition
  function faceLayer() {
    if (!isDisplayFrame()) { faceBox?.remove(); return null; }
    if (!faceBox) {
      faceBox = document.createElement('div'); faceBox.id = 'cowatch-faces';
      faceBox.style.cssText = 'position:fixed;top:18px;left:18px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-start;gap:10px;pointer-events:none;font:600 12px system-ui,sans-serif';
    }
    const par = layerParent(); if (faceBox.parentNode !== par) par.append(faceBox);
    return faceBox;
  }
  function colorOf(name) { let h = 0; for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 45% 38%)`; }
  function faceEl(p) {
    const w = document.createElement('div'); w.dataset.id = p.id;
    w.style.cssText = 'display:flex;align-items:center;gap:8px;transition:opacity .25s,transform .25s;opacity:0;transform:translateX(-8px)';
    const lab = document.createElement('span'); lab.textContent = p.self ? 'Toi' : p.name;
    lab.style.cssText = 'color:#fff;background:rgba(15,14,19,.72);padding:3px 8px;border-radius:999px;text-shadow:0 1px 2px #000';
    let pic;
    if (p.avatar) { pic = document.createElement('img'); pic.src = p.avatar; pic.alt = ''; pic.style.objectFit = 'cover'; }
    else { pic = document.createElement('div'); pic.textContent = (p.name || '?').charAt(0).toUpperCase(); pic.style.cssText = `display:grid;place-items:center;color:#fff;font-size:20px;background:${colorOf(p.name)}`; }
    pic.style.width = pic.style.height = '52px'; pic.style.borderRadius = '50%'; pic.style.boxShadow = '0 0 0 3px #ffd23c,0 6px 18px rgba(0,0,0,.45)';
    w.append(pic, lab); return w;
  }
  function showFace(id, on) {
    const box = faceLayer(); if (!box) return;
    const p = roster.get(id); if (!p) return;
    let el = box.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (on) {
      clearTimeout(speaking.get(id));
      if (!el) { el = faceEl(p); box.append(el); requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'none'; }); }
    } else if (el) {
      speaking.set(id, setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 260); }, 900));
    }
  }
  // Micro coupé : petite pastille permanente pour le savoir même en plein écran.
  function renderMuted() {
    const box = faceLayer(); if (!box) return;
    const self = [...roster.values()].find(p => p.self);
    let pill = box.querySelector('[data-muted]');
    if (self && self.muted) {
      if (!pill) { pill = document.createElement('div'); pill.dataset.muted = '1'; pill.textContent = '🔇 Micro coupé'; pill.style.cssText = 'color:#fff;background:rgba(255,90,60,.9);padding:4px 10px;border-radius:999px'; box.prepend(pill); }
    } else pill?.remove();
  }
  function toast(text) { banner(text); }
  // ---------- Messages du chat : en bas à droite, en transparence, ils s'effacent seuls ----------
  function chatLayer() {
    if (!isDisplayFrame()) { chatBox?.remove(); return null; }
    if (!chatBox) {
      chatBox = document.createElement('div'); chatBox.id = 'cowatch-chat';
      chatBox.style.cssText = 'position:fixed;right:24px;bottom:96px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:min(380px,40vw);pointer-events:none;font:14px/1.35 system-ui,sans-serif';
    }
    const par = layerParent(); if (chatBox.parentNode !== par) par.append(chatBox);
    return chatBox;
  }
  function showChat(name, text, big) {
    const box = chatLayer(); if (!box) return;
    const p = [...roster.values()].find(x => x.name === name);
    const d = document.createElement('div');
    d.style.cssText = 'color:#fff;background:rgba(15,14,19,.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:6px 11px;border-radius:14px;text-shadow:0 1px 2px rgba(0,0,0,.6);transition:opacity .5s;opacity:0;word-wrap:break-word;max-width:100%';
    const b = document.createElement('b'); b.textContent = (p && p.self ? 'Toi' : name) + ' '; b.style.color = '#ffd23c';
    const t = document.createElement('span'); t.textContent = text; if (big) t.style.fontSize = '22px';
    d.append(b, t); box.append(d);
    requestAnimationFrame(() => { d.style.opacity = '1'; });
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 600); }, 9000);
  }
  document.addEventListener('fullscreenchange', () => {
    faceLayer(); chatLayer(); renderMuted(); if (bannerEl?.isConnected) isDisplayFrame() ? layerParent().append(bannerEl) : bannerEl.remove();
    renderReopen();
  });

  // ---------- Bouton « rouvrir Cowatch » ----------
  // Quand on est dans un salon et que le panneau est fermé, une petite languette sur le bord droit de la page le rouvre.
  // Elle disparaît pendant le plein écran du programme, et revient dès qu'on en sort.
  let inRoom = false, panelOpen = true, unread = 0, reopenEl = null;
  function renderReopen() {
    if (window.top !== window) return;
    const show = inRoom && !panelOpen && !document.fullscreenElement;
    if (!show) { reopenEl?.remove(); return; }
    if (!reopenEl) {
      reopenEl = document.createElement('button'); reopenEl.id = 'cowatch-reopen'; reopenEl.type = 'button';
      reopenEl.setAttribute('aria-label', 'Ouvrir Cowatch');
      reopenEl.style.cssText = 'position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147483646;display:flex;align-items:center;gap:7px;background:#ff5a3c;color:#fff;border:0;border-radius:12px 0 0 12px;padding:11px 12px 11px 14px;font:700 13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.4);cursor:pointer';
      reopenEl.onclick = async () => {
        const r = await chrome.runtime.sendMessage({ cmd: 'openPanel' }).catch(() => null);
        if (r && r.ok) { panelOpen = true; unread = 0; renderReopen(); }
      };
      document.addEventListener('fullscreenchange', renderReopen);
    }
    reopenEl.textContent = '💬 Cowatch';
    if (unread) { const n = document.createElement('span'); n.textContent = unread > 9 ? '9+' : String(unread); n.style.cssText = 'background:#fff;color:#ff5a3c;border-radius:999px;padding:1px 7px;font-size:12px'; reopenEl.append(n); }
    if (!reopenEl.isConnected) document.documentElement.append(reopenEl);
  }
  chrome.runtime.onMessage.addListener(m => {
    if (m.t === 'panel') { panelOpen = !!m.open; if (panelOpen) unread = 0; renderReopen(); return; }
    if (m.t === 'roster') { roster = new Map(m.people.map(p => [p.id, p])); renderMuted(); return; }
    if (m.t === 'speak') { showFace(m.id, m.on); return; }
    if (m.t === 'toast') { toast(m.text); return; }
    if (m.t === 'diag') { diagnose().then(d => chrome.runtime.sendMessage({ cmd: 'diag', data: d }).catch(() => {})); return; }
    if (m.t === 'ping-video') { if (video) chrome.runtime.sendMessage({ cmd: 'video', found: true }).catch(() => {}); return; }
    if (m.t === 'welcome') { inRoom = true; renderReopen(); mode = m.mode || 'vod'; me = m.id; host = m.host || m.id; offset = m.offset || 0; startStateLoop(); if (video) banner(isHost() ? 'Salon connecté — tu pilotes la lecture' : 'Salon connecté — calage sur le pilote…'); }
    else if (m.t === 'host') { host = m.id; startStateLoop(); }
    else if (m.t === 'state-request') emit(video && !video.paused ? 'state' : 'pause');
    else if (m.t === 'sync') { apply(m); if (m.action !== 'state') banner(`${m.name} : ${{ play: '▶ lecture', pause: '⏸ pause', seek: '⏩ avance' }[m.action] || m.action}`); }
    else if (m.t === 'reaction') showChat(m.name, m.emoji, true);
    else if (m.t === 'chat') { showChat(m.name, m.text); if (!panelOpen) { unread++; renderReopen(); } }
    else if (m.t === 'mode') { mode = m.mode; banner(mode === 'live' ? 'Mode match : alignement sur le plus lent' : 'Mode série : lecture partagée'); }
    else if (m.t === 'align') align(m.pauseFor, m.auto);
    else if (m.t === 'disconnected') { me = null; inRoom = false; renderReopen(); banner('Cowatch déconnecté'); }
  });
})();
