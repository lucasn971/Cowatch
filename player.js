// Content script : repère la vidéo principale de la page et applique / émet les commandes de lecture.
(() => {
  if (window.__salonSync) return; window.__salonSync = true;
  let video = null, me = null, host = null, offset = 0, ignoreUntil = 0, stateTimer = null, mode = 'vod', alignTimer = null;
  const DRIFT = 0.8;           // tolérance de dérive en secondes avant recalage
  const isHost = () => me && me === host;
  const quiet = (ms = 700) => { ignoreUntil = Date.now() + ms; };

  function findVideo() {
    const vids = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 || v.src || v.currentSrc);
    vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
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
  setInterval(() => attach(findVideo()), 1000);
  chrome.runtime.sendMessage({ cmd: 'hello' }).catch(() => {}); // page (re)chargée : le panneau renvoie l'état du salon

  // Invitation en attente : petite bulle qui ouvre le panneau d'un clic.
  if (window.top === window) chrome.storage.local.get('pendingJoin').then(({ pendingJoin }) => {
    if (!pendingJoin || Date.now() - pendingJoin.at > 30 * 60 * 1000) return;
    const b = document.createElement('button');
    b.textContent = `Rejoindre le salon ${pendingJoin.code}`;
    b.style.cssText = 'position:fixed;right:20px;bottom:24px;z-index:2147483647;background:#ff5a3c;color:#fff;border:0;border-radius:999px;padding:12px 18px;font:600 14px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer';
    b.onclick = async () => { const r = await chrome.runtime.sendMessage({ cmd: 'openPanel' }).catch(() => null); if (r && r.ok) b.remove(); else b.textContent = 'Clique sur l\'icône Salon en haut à droite'; };
    document.documentElement.append(b);
  }).catch(() => {});

  // Le pilote publie son état toutes les 3 s : les autres corrigent leur dérive.
  function startStateLoop() {
    clearInterval(stateTimer);
    stateTimer = setInterval(() => { if (mode === 'vod' && isHost() && video && !video.paused) emit('state'); }, 3000);
  }

  async function apply(m) {
    if (!video || mode !== 'vod') return;
    const now = Date.now() + offset;
    const target = m.time + (m.playing ? Math.max(0, now - m.sentAt) / 1000 * (m.rate || 1) : 0);
    const drift = video.currentTime - target;
    if (m.action === 'state' && Math.abs(drift) < DRIFT && video.paused === !m.playing) return;
    quiet();
    if (Math.abs(drift) > (m.action === 'state' ? DRIFT : 0.3)) video.currentTime = target;
    if (m.playing && video.paused) { try { await video.play(); } catch { banner('Clique sur ▶ pour rejoindre la lecture'); } }
    if (!m.playing && !video.paused) video.pause();
  }

  // Alignement en direct : on se met en pause le temps de son avance, puis on relance.
  // Fonctionne si le lecteur autorise la pause du direct (Canal+ : "contrôle du direct", à vérifier sur chaque chaîne).
  function align(sec) {
    if (!video || !(sec > 0)) return;
    clearTimeout(alignTimer);
    quiet(sec * 1000 + 1500);
    video.pause();
    banner(`Alignement : pause ${sec.toFixed(1)} s`);
    alignTimer = setTimeout(async () => { quiet(); try { await video.play(); banner('Aligné ✓'); } catch { banner('Clique sur ▶ pour reprendre'); } }, sec * 1000);
  }

  let bannerEl;
  function banner(txt) {
    if (window.top !== window) return;
    bannerEl = bannerEl || Object.assign(document.createElement('div'), { style: 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#ff5a3c;color:#fff;font:600 13px system-ui;padding:8px 12px;border-radius:8px;pointer-events:none' });
    bannerEl.textContent = txt; document.documentElement.append(bannerEl);
    clearTimeout(bannerEl._t); bannerEl._t = setTimeout(() => bannerEl.remove(), 3500);
  }

  chrome.runtime.onMessage.addListener(m => {
    if (m.t === 'ping-video') { if (video) chrome.runtime.sendMessage({ cmd: 'video', found: true }).catch(() => {}); return; }
    if (m.t === 'welcome') { mode = m.mode || 'vod'; me = m.id; host = m.host || m.id; offset = m.offset || 0; startStateLoop(); if (video) banner(isHost() ? 'Salon connecté — tu pilotes la lecture' : 'Salon connecté — calage sur le pilote…'); }
    else if (m.t === 'host') { host = m.id; startStateLoop(); }
    else if (m.t === 'state-request') emit(video && !video.paused ? 'state' : 'pause');
    else if (m.t === 'sync') { apply(m); if (m.action !== 'state') banner(`${m.name} : ${{ play: '▶ lecture', pause: '⏸ pause', seek: '⏩ avance' }[m.action] || m.action}`); }
    else if (m.t === 'reaction') banner(`${m.name} ${m.emoji}`);
    else if (m.t === 'chat') banner(`${m.name} : ${m.text.length > 80 ? m.text.slice(0, 80) + '…' : m.text}`);
    else if (m.t === 'mode') { mode = m.mode; banner(mode === 'live' ? 'Mode match : alignement sur le plus lent' : 'Mode série : lecture partagée'); }
    else if (m.t === 'align') align(m.pauseFor);
    else if (m.t === 'disconnected') { me = null; banner('Salon déconnecté'); }
  });
})();
