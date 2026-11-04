// Cowatch — « mode A » (Android) : le lecteur d'une appli officielle (Netflix, Canal+, Crunchyroll…) vu comme une balise <video>.
// L'appli native lit et commande ce lecteur par l'accès « contrôle des médias » d'Android (ce que font les télécommandes
// Bluetooth et les montres) ; ici, on le présente au cœur sous la forme d'une <video> ordinaire, pour que coeur/player.js
// (calage, pilote, pauses, réactions) tourne SANS MODIFICATION, exactement comme sur un site.
//
//   appli native → page : événement « media » {ok, app, nom, titre, etat: playing|paused|none, pos (s), vitesse, duree (s|null), t (ms)}
//   page → appli native : media.play · media.pause · media.seek {ms} · media.etat
//
// Rien d'autre : la page ne voit ni l'écran, ni les notifications, ni le contenu de l'appli officielle.
(() => {
  const C = window.__piloteCoque;
  const v = document.createElement('video');
  v.id = 'appli-officielle'; v.muted = true; v.setAttribute('playsinline', '');
  v.style.cssText = 'display:block;width:640px;height:360px;background:#000';
  document.body.appendChild(v);

  // État connu du lecteur de l'appli officielle, et prédiction de sa position entre deux nouvelles.
  let st = { ok: false, playing: false, pos: 0, at: Date.now(), rate: 1, dur: null, app: '', nom: '', titre: '' };
  const maintenant = () => st.playing ? st.pos + (Date.now() - st.at) / 1000 * st.rate : st.pos;
  // Ce que nous venons de demander : la nouvelle qui le confirme ne doit pas repartir vers le salon comme une action de l'utilisateur.
  let attendu = null;
  const attendre = a => { attendu = { ...a, jusqua: Date.now() + 3000 }; };
  const fire = t => setTimeout(() => v.dispatchEvent(new Event(t)), 0);
  const def = (k, d) => Object.defineProperty(v, k, { configurable: true, ...d });
  let rate = 1;

  def('currentTime', {
    get: maintenant,
    set: t => {
      t = Math.max(0, Number(t) || 0);
      st.pos = t; st.at = Date.now(); attendre({ pos: t });
      C.call('media.seek', { ms: Math.round(t * 1000) });
      fire('seeking'); fire('seeked');
    },
  });
  def('paused', { get: () => !st.playing });
  def('ended', { get: () => false });
  def('duration', { get: () => (st.dur && st.dur > 0 ? st.dur : 6 * 3600) }); // durée inconnue : replay long (le direct n'est pas géré en mode A)
  def('readyState', { get: () => (st.ok ? 4 : 0) });
  def('currentSrc', { get: () => (st.ok ? 'appli:' + st.app : '') });
  def('seekable', { get: () => ({ length: 1, start: () => 0, end: () => (st.dur && st.dur > 0 ? st.dur : 6 * 3600) }) });
  // Le ralenti (calage fin du direct) n'existe pas pour une appli officielle : on le garde sans l'appliquer.
  def('playbackRate', { get: () => rate, set: r => { rate = Number(r) || 1; } });
  def('play', {
    value: () => {
      st.pos = maintenant(); st.at = Date.now(); st.playing = true; attendre({ playing: true });
      C.call('media.play'); fire('play'); fire('playing');
      return Promise.resolve();
    },
  });
  def('pause', {
    value: () => {
      st.pos = maintenant(); st.at = Date.now(); st.playing = false; attendre({ playing: false });
      C.call('media.pause'); fire('pause');
    },
  });

  // Nouvelle du lecteur de l'appli officielle : si elle ne vient pas de nous, c'est une action de l'utilisateur dans
  // l'appli (lecture, pause, avance) : on la rejoue comme le ferait une vraie vidéo, et player.js l'envoie au salon.
  function nouvelle(d) {
    if (!d) return;
    const avant = { ok: st.ok, playing: st.playing, pos: maintenant() };
    const ok = !!d.ok && d.etat !== 'none';
    const playing = d.etat === 'playing';
    const pos = Number(d.pos) + (playing && d.t ? Math.max(0, Date.now() - d.t) / 1000 * (Number(d.vitesse) || 1) : 0);
    st = { ok, playing, pos: isFinite(pos) ? pos : 0, at: Date.now(), rate: Number(d.vitesse) || 1,
      dur: d.duree > 0 ? Number(d.duree) : null, app: d.app || '', nom: d.nom || '', titre: d.titre || '' };
    document.title = ok ? `${st.nom || st.app} · appli officielle` : 'Cowatch · appli officielle';
    if (!ok || !avant.ok) { if (ok) fire('loadedmetadata'); return; }
    const a = attendu && Date.now() < attendu.jusqua ? attendu : null;
    const attenduJeu = a && 'playing' in a && a.playing === playing;
    const attenduPos = a && 'pos' in a && Math.abs(a.pos - st.pos) < 3;
    if (playing !== avant.playing) {
      if (attenduJeu) attendu = null; else fire(playing ? 'play' : 'pause');
    } else if (Math.abs(st.pos - avant.pos) > 2) {
      if (attenduPos) attendu = null; else { fire('seeking'); fire('seeked'); }
    }
  }
  C.on('media', nouvelle);
  // Au chargement (ou après un retour dans Cowatch) : l'état actuel.
  const demander = () => C.call('media.etat').then(nouvelle).catch(() => {});
  demander();
  window.__piloteEtat = () => ({ ...st, pos: maintenant() }); // pour les tests et le diagnostic
})();
