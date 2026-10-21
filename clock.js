// Cowatch — « heure réelle de l'image » pour le calage automatique du direct.
// Ce script tourne DANS la page du site (monde « MAIN »), dès son ouverture, pour voir ce que voit le lecteur vidéo :
//  1. les listes de morceaux du direct (HLS .m3u8 / DASH .mpd), qui donnent l'heure réelle de chaque morceau ;
//  2. le téléchargement de chaque morceau, puis son ajout dans le lecteur (SourceBuffer).
// En reliant les deux, on sait exactement à quelle heure réelle correspond chaque seconde de la vidéo,
// quel que soit le lecteur (hls.js, Shaka, dash.js, lecteurs maison). Rien n'est modifié, rien n'est envoyé :
// le résultat est seulement écrit sur la balise <video> (data-cowatch-map), où l'extension le lit.
(() => {
  if (window.__cowatchClock) return; window.__cowatchClock = true;
  const segs = new Map();      // adresse du morceau -> {wall (ms), dur (s), kind}
  const loaded = [];           // morceaux téléchargés récemment : {url, wall, dur, len, at}
  const sbInfo = new WeakMap(); // SourceBuffer -> {kind, pending}
  const msOfUrl = new Map();   // adresse blob: -> MediaSource
  const maps = new WeakMap();  // MediaSource -> {samples:[{m, off}], method}
  const dbg = window.__cowatchDbg = { playlists: 0, segs: 0, loaded: 0, appends: 0, matched: 0, samples: 0, lens: [] };
  const abs = (u, base) => { try { return new URL(u, base).href; } catch { return u; } };
  const keyOf = u => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return String(u).split('?')[0]; } };

  // ---------- Lecture des listes de morceaux ----------
  function parseHls(text, url) {
    if (!text.startsWith('#EXTM3U') || !text.includes('#EXTINF')) return;
    let pdt = null, dur = 0, n = 0;
    for (const raw of text.split('\n')) {
      const l = raw.trim(); if (!l) continue;
      if (l.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) { const t = Date.parse(l.slice(25)); if (!isNaN(t)) pdt = t; }
      else if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8)) || 0;
      else if (l.startsWith('#EXT-X-DISCONTINUITY') && !l.includes('SEQUENCE')) { /* l'heure est redonnée juste après */ }
      else if (!l.startsWith('#')) {
        if (pdt != null) { segs.set(keyOf(abs(l, url)), { wall: pdt, dur }); n++; pdt += dur * 1000; }
        dur = 0;
      }
    }
    if (segs.size > 4000) { const it = segs.keys(); for (let i = 0; i < 1000; i++) segs.delete(it.next().value); }
    if (n && !text.includes('#EXT-X-ENDLIST')) liveSeen = Date.now(); // liste sans fin = direct
    if (n) { lastPlaylist = { at: Date.now(), kind: 'hls' }; dbg.playlists++; dbg.segs = segs.size; }
  }
  // DASH : heure réelle = début de disponibilité du direct + début de la période + temps du morceau.
  function parseDash(text, url) {
    if (!/<MPD[\s>]/.test(text) || !/type="dynamic"/.test(text)) return;
    try {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      const mpd = doc.querySelector('MPD'); const ast = Date.parse(mpd.getAttribute('availabilityStartTime') || '');
      if (isNaN(ast)) return;
      dashAst = ast;
      for (const period of doc.querySelectorAll('Period')) {
        const pStart = isoDur(period.getAttribute('start')) || 0;
        for (const rep of period.querySelectorAll('Representation')) {
          const tpl = rep.querySelector('SegmentTemplate') || rep.parentElement.querySelector(':scope > SegmentTemplate');
          if (!tpl || !tpl.getAttribute('media')) continue;
          const ts = +tpl.getAttribute('timescale') || 1, pto = +tpl.getAttribute('presentationTimeOffset') || 0;
          const base = baseUrl(rep, url), media = tpl.getAttribute('media'), id = rep.getAttribute('id'), bw = rep.getAttribute('bandwidth');
          let num = +tpl.getAttribute('startNumber') || 1, t = 0;
          for (const s of tpl.querySelectorAll('SegmentTimeline > S')) {
            if (s.hasAttribute('t')) t = +s.getAttribute('t');
            const d = +s.getAttribute('d'), r = +s.getAttribute('r') || 0;
            for (let i = 0; i <= r; i++) {
              const u = media.replace(/\$RepresentationID\$/g, id).replace(/\$Bandwidth\$/g, bw).replace(/\$Time\$/g, t).replace(/\$Number(%0(\d+)d)?\$/g, (_, f, w) => String(num).padStart(+w || 0, '0'));
              const wall = ast + (pStart + (t - pto) / ts) * 1000;
              if (wall > Date.now() - 10 * 60 * 1000) segs.set(keyOf(abs(u, base)), { wall, dur: d / ts }); // 10 dernières minutes

              t += d; num++;
            }
          }
        }
      }
      lastPlaylist = { at: Date.now(), kind: 'dash' }; liveSeen = Date.now();
      for (const [k, v] of segs) if (v.wall < Date.now() - 15 * 60 * 1000) segs.delete(k);
    } catch {}
  }
  let dashAst = null, lastPlaylist = null, liveSeen = 0;
  function isoDur(v) { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(v || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; }
  function baseUrl(el, url) { let b = url; const chain = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const x = e.querySelector(':scope > BaseURL'); if (x) chain.unshift(x.textContent.trim()); } for (const c of chain) b = abs(c, b); return b; }
  function sawText(url, text) { if (typeof text !== 'string' || text.length > 5e6) return; if (text.startsWith('#EXTM3U')) parseHls(text, url); else if (text.includes('<MPD')) parseDash(text, url); }
  function sawSegment(url, len) {
    const s = segs.get(keyOf(url)); if (!s) return;
    dbg.loaded++; dbg.lens.push('L' + len); if (dbg.lens.length > 20) dbg.lens.shift();
    loaded.push({ url, wall: s.wall, dur: s.dur, len, at: performance.now() }); if (loaded.length > 60) loaded.shift();
  }
  const looksText = u => /\.m3u8|\.mpd|manifest|playlist|master|index/i.test(u);

  // ---------- Observation des téléchargements du lecteur (sans les modifier) ----------
  const _fetch = window.fetch;
  if (_fetch) window.fetch = function (input, init) {
    const p = _fetch.apply(this, arguments);
    const url = abs(typeof input === 'string' ? input : input && input.url, location.href);
    p.then(res => {
      try {
        if (!res || !res.ok) return;
        const known = segs.has(keyOf(url)), ct = res.headers.get('content-type') || '';
        if (known) res.clone().arrayBuffer().then(b => sawSegment(url, b.byteLength)).catch(() => {});
        else if (looksText(url) || /mpegurl|dash\+xml/i.test(ct)) res.clone().text().then(t => sawText(url, t)).catch(() => {});
      } catch {}
    }).catch(() => {});
    return p;
  };
  const XO = XMLHttpRequest.prototype.open;
  // Écouteur posé dès open() : il passe avant celui du lecteur, qui peut ensuite céder les octets à un worker (taille 0).
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__cwUrl = abs(u, location.href);
    if (!this.__cwHooked) {
      this.__cwHooked = true; const x = this;
      x.addEventListener('readystatechange', () => {
        if (x.readyState !== 4) return;
        try {
          if (x.status < 200 || x.status >= 300) return; const url = x.responseURL || x.__cwUrl;
          if (segs.has(keyOf(url))) { const r = x.response; sawSegment(url, r && r.byteLength != null ? r.byteLength : (typeof r === 'string' ? r.length : 0)); }
          else if (x.responseType === '' || x.responseType === 'text') sawText(url, x.responseText);
          else if (x.responseType === 'arraybuffer' && looksText(url) && x.response && x.response.byteLength < 5e6) sawText(url, new TextDecoder().decode(x.response));
        } catch {}
      });
    }
    return XO.apply(this, arguments);
  };

  // ---------- Ajout des morceaux dans le lecteur : on relie temps vidéo <-> heure réelle ----------
  if (window.MediaSource || window.ManagedMediaSource) {
    const MS = window.MediaSource || window.ManagedMediaSource;
    const COU = URL.createObjectURL;
    URL.createObjectURL = function (o) { const u = COU.apply(this, arguments); try { if (o instanceof MS) msOfUrl.set(u, o); } catch {} return u; };
    const ASB = MS.prototype.addSourceBuffer;
    MS.prototype.addSourceBuffer = function (mime) {
      const sb = ASB.apply(this, arguments), ms = this;
      sbInfo.set(sb, { kind: /video/i.test(mime) ? 'video' : 'audio', ms });
      sb.addEventListener('updateend', () => onAppended(sb));
      return sb;
    };
    const SB = (window.SourceBuffer || window.ManagedSourceBuffer).prototype, AB = SB.appendBuffer;
    SB.appendBuffer = function (data) {
      const info = sbInfo.get(this);
      if (info) { dbg.appends++; dbg.lens.push('A' + data.byteLength); info.pending = { len: data.byteLength, before: ranges(this), at: performance.now() }; }
      return AB.apply(this, arguments);
    };
  }
  function ranges(sb) { const a = []; try { const b = sb.buffered; for (let i = 0; i < b.length; i++) a.push([b.start(i), b.end(i)]); } catch {} return a; }
  function onAppended(sb) {
    const info = sbInfo.get(sb); const p = info && info.pending; if (!p) return; info.pending = null;
    if (p.len < 1000) return; // segment d'initialisation
    // Le morceau ajouté = celui de même taille téléchargé juste avant (méthode exacte) ; sinon le dernier téléchargé.
    let frag = null;
    for (let i = loaded.length - 1; i >= 0; i--) if (loaded[i].len === p.len && !loaded[i].used) { frag = loaded[i]; break; }
    const exact = !!frag;
    if (!frag) return;
    frag.used = true; dbg.matched++;
    // Nouvelle portion de vidéo apparue dans le tampon (ce qui est couvert maintenant et ne l'était pas avant).
    let best = null;
    for (const [s, e] of ranges(sb)) {
      let pieces = [[s, e]];
      for (const [bs, be] of p.before) pieces = pieces.flatMap(([ps, pe]) => be <= ps || bs >= pe ? [[ps, pe]] : [[ps, Math.min(pe, bs)], [Math.max(ps, be), pe]].filter(([x, y]) => y - x > 0.01));
      for (const [ps, pe] of pieces) if (!best || pe - ps > best.len) best = { s: ps, e: pe, len: pe - ps, atEnd: Math.abs(pe - e) < 0.01 };
    }
    if (!best || best.len < Math.min(0.5, frag.dur * 0.3)) return;
    // Morceau ajouté à la suite : son début = fin - durée (les bords se chevauchent souvent de quelques ms).
    const start = best.atEnd && best.len < frag.dur ? best.e - frag.dur : best.s;
    addSample(info.ms, start, frag.wall, exact ? 'exact' : 'approx');
  }
  function addSample(ms, mediaStart, wall, quality) {
    let m = maps.get(ms); if (!m) { m = { samples: [] }; maps.set(ms, m); }
    m.samples = m.samples.filter(x => Math.abs(x.m - mediaStart) > 0.05);
    m.samples.push({ m: +mediaStart.toFixed(3), off: Math.round(wall - mediaStart * 1000), q: quality });
    m.samples.sort((a, b) => a.m - b.m); if (m.samples.length > 40) m.samples.shift();
    dbg.samples++; publish(ms);
  }
  // On écrit la correspondance sur la balise <video> concernée : l'extension la lit de son côté.
  function publish(ms) {
    const m = maps.get(ms); if (!m) return;
    for (const v of document.querySelectorAll('video')) {
      const src = v.currentSrc || v.src;
      if ((src && msOfUrl.get(src) === ms) || v.srcObject === ms) v.setAttribute('data-cowatch-map', JSON.stringify(m.samples.slice(-12)));
    }
  }
  // Commandes venues de l'extension pour les lecteurs qui exigent leur propre API (Netflix).
  document.addEventListener('cowatch-cmd', e => {
    let c; try { c = JSON.parse(e.detail); } catch { return; }
    if (c.seek != null && window.netflix) {
      try {
        const vp = netflix.appContext.state.playerApp.getAPI().videoPlayer;
        const id = vp.getAllPlayerSessionIds().find(s => s.startsWith('watch')) || vp.getAllPlayerSessionIds()[0];
        vp.getVideoPlayerBySessionId(id).seek(Math.round(c.seek * 1000)); // Netflix compte en millisecondes
      } catch {}
    }
  });
  // Repli pour DASH quand la page ne passe pas par ces étapes : début de disponibilité connu.
  setInterval(() => {
    // Direct détecté par la liste de morceaux (certains lecteurs donnent une durée finie qui grandit, comme hls.js).
    if (liveSeen && Date.now() - liveSeen < 30000) for (const v of document.querySelectorAll('video')) if (/^blob:/.test(v.currentSrc || v.src || '') && v.dataset.cowatchLive !== '1') v.dataset.cowatchLive = '1';
    // YouTube en direct : le lecteur donne lui-même l'heure réelle de l'image (getMediaReferenceTime).
    if (/(^|\.)youtube\.com$/.test(location.hostname)) {
      const mp = document.getElementById('movie_player'), v = mp && mp.querySelector('video');
      try { const r = mp && mp.getMediaReferenceTime && mp.getMediaReferenceTime(); if (v && r > 1e9) v.setAttribute('data-cowatch-map', JSON.stringify([{ m: 0, off: Math.round(r * 1000 - v.currentTime * 1000), q: 'lecteur' }])); } catch {}
    }
    if (dashAst == null) return;
    for (const v of document.querySelectorAll('video')) if (!v.hasAttribute('data-cowatch-map')) v.setAttribute('data-cowatch-ast', String(dashAst));
  }, 1000);
})();
