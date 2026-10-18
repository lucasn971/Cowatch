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
    for (const ev of ['play', 'pause', 'seeked']) v.addEventListener(ev, () => {
      if (Date.now() < ignoreUntil || !me || mode !== 'vod') return; // en direct, chacun garde son flux
      emit(ev === 'seeked' ? 'seek' : ev);
    });
  }
  function emit(action) {
    if (!video) return;
    chrome.runtime.sendMessage({ cmd: 'sync', action, time: video.currentTime, playing: !video.paused, rate: video.playbackRate }).catch(() => {});
  }
  setInterval(() => attach(findVideo()), 1000);

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
    if (m.t === 'welcome') { mode = m.mode || 'vod'; me = m.id; host = m.host || m.id; offset = m.offset || 0; startStateLoop(); if (video) banner(isHost() ? 'Salon connecté — tu pilotes la lecture' : 'Salon connecté — calage sur le pilote…'); }
    else if (m.t === 'host') { host = m.id; startStateLoop(); }
    else if (m.t === 'state-request') emit(video && !video.paused ? 'state' : 'pause');
    else if (m.t === 'sync') { apply(m); if (m.action !== 'state') banner(`${m.name} : ${{ play: '▶ lecture', pause: '⏸ pause', seek: '⏩ avance' }[m.action] || m.action}`); }
    else if (m.t === 'reaction') banner(`${m.name} ${m.emoji}`);
    else if (m.t === 'mode') { mode = m.mode; banner(mode === 'live' ? 'Mode match : alignement sur le plus lent' : 'Mode série : lecture partagée'); }
    else if (m.t === 'align') align(m.pauseFor);
    else if (m.t === 'disconnected') { me = null; banner('Salon déconnecté'); }
  });
})();
