// Moteur Cowatch : connexions au serveur, voix WebRTC, chat, synchro du lecteur.
// Chrome / Edge / Brave : tourne dans un document caché (offscreen) => la voix continue même panneau fermé
// (mode plein écran). Firefox / Opera : chargé directement dans le panneau (même code).
(() => {
  const OFFSCREEN = !chrome.tabs; // un document offscreen n'a accès qu'à chrome.runtime
  const EMIT = self.__cowatchEmit || (ev => chrome.runtime.sendMessage({ to: 'ui', ...ev }).catch(() => {}));
  let ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

  const S = { // état exposé au panneau
    server: '', code: null, me: null, tabId: null, mode: 'vod', muted: false, needMic: false, err: '',
    video: false, live: null, calib: null, autosync: null,
  };
  let wsS = null, wsP = null, localStream = null, lastWelcome = null, myAvatar = null;
  let retryS = 0, retryP = 0, pingS = null, pingP = null, reconnectingS = false;
  const peers = new Map(); // id -> {id, name, kind, avatar, pc, audio, state, speaking}
  const log = [];          // derniers messages (chat + système) pour réafficher le panneau à sa réouverture

  // ---------- Communication avec le panneau ----------
  let snapQueued = false;
  function snap(full) {
    if (full) return EMIT({ ev: 'snap', state: snapshot(), log });
    if (snapQueued) return; snapQueued = true;
    queueMicrotask(() => { snapQueued = false; EMIT({ ev: 'snap', state: snapshot() }); });
  }
  function snapshot() {
    return { ...S, inRoom: !!(S.me && S.me.id),
      peers: [...peers.values()].filter(p => p.kind === 'salon').map(p => ({ id: p.id, name: p.name, avatar: p.avatar || null, state: p.state || '', speaking: !!p.speaking, self: p.id === S.me?.id })) };
  }
  function addLog(item) { log.push(item); if (log.length > 150) log.shift(); EMIT({ ev: 'log', item }); }
  const sys = text => addLog({ kind: 'sys', text, at: Date.now() });

  // ---------- Vers l'onglet de la plateforme ----------
  function toTab(m) {
    if (S.tabId == null) return;
    if (OFFSCREEN) chrome.runtime.sendMessage({ to: 'bg', cmd: 'relay', tabId: S.tabId, m }).catch(() => {});
    else chrome.tabs.sendMessage(S.tabId, m).catch(() => {});
  }
  function pushRoster() {
    if (!S.me?.id) return;
    const people = [...peers.values()].filter(p => p.kind === 'salon').map(p => ({ id: p.id, name: p.name, avatar: p.id === S.me.id ? myAvatar : p.avatar || null, self: p.id === S.me.id, muted: p.id === S.me.id ? S.muted : false }));
    toTab({ t: 'roster', people });
  }

  // ---------- Commandes reçues du panneau ----------
  async function handle(m) {
    switch (m.cmd) {
      case 'hello': if (m.tabId != null && !S.code) S.tabId = m.tabId; snap(true); if (S.code) toTab({ t: 'ping-video' }); break;
      case 'join': return join(m);
      case 'leave': return leave();
      case 'chat': { const v = String(m.text || '').trim(); if (v) sendS({ t: 'chat', text: v }); break; }
      case 'reaction': sendS({ t: 'reaction', emoji: m.emoji }); break;
      case 'mute': S.muted = m.value != null ? !!m.value : !S.muted; applyMic(); if (m.toast) toTab({ t: 'toast', text: S.muted ? 'Micro coupé' : 'Micro activé' }); break;
      case 'avatar': myAvatar = m.avatar || null; sendS({ t: 'avatar', avatar: myAvatar }); pushRoster(); break;
      case 'calibStart': sendS({ t: 'calib-start', label: 'le score change à l\'écran (ou le prochain coup de sifflet)' }); break;
      case 'top': if (S.calib && !S.calib.myTop) { S.calib.myTop = true; sendS({ t: 'top', id: S.calib.id }); snap(); } break;
      case 'align': sendS({ t: 'align' }); break;
      case 'micGranted': if (S.code) reconnectWithMic(); break;
    }
  }

  // ---------- Messages venant de l'onglet (content script) ----------
  function fromTab(m) {
    if (m.cmd === 'sync') sendP({ t: 'sync', action: m.action, time: m.time, playing: m.playing, rate: m.rate });
    if (m.cmd === 'clock') sendP({ t: 'clock', pos: m.pos, paused: m.paused });
    if (m.cmd === 'hello' && lastWelcome) { toTab(lastWelcome); pushRoster(); }
    if (m.cmd === 'video') { S.video = !!m.found; snap(); }
    if (m.cmd === 'kind') { S.live = !!m.live; autoMode(); snap(); }
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m.to === 'engine' && m.cmd === 'stats') { // utilisé par les tests et le diagnostic
      reply({ audio: [...peers.values()].filter(p => p.audio && p.audio.srcObject && p.audio.srcObject.getAudioTracks().length).length, mic: !!localStream, inRoom: !!S.me?.id });
      return;
    }
    if (m.to === 'engine') { handle(m); return; }
    if (m.cmd === 'micGranted') { handle(m); return; }
    if (sender.tab && sender.tab.id === S.tabId) fromTab(m);
  });
  self.__cowatchEngine = { handle }; // mode « dans le panneau » (Firefox, Opera)

  // ---------- Salon ----------
  async function join(m) {
    S.server = m.server; S.tabId = m.tabId ?? S.tabId; myAvatar = m.avatar || null; S.err = '';
    S.me = { name: m.name }; S.code = String(m.code).toUpperCase();
    await getMic();
    try { const j = await (await fetch(S.server.replace(/\/$/, '') + '/ice')).json(); if (j.iceServers) ICE = j.iceServers; } catch {}
    connectSalon(); snap();
  }
  function leave() {
    S.code = null; clearInterval(pingS); clearInterval(pingP); wsS?.close(); wsP?.close();
    peers.forEach(p => { p.pc?.close(); p.audio?.remove(); }); peers.clear(); log.length = 0;
    localStream?.getTracks().forEach(t => t.stop()); localStream = null;
    toTab({ t: 'disconnected' });
    Object.assign(S, { me: null, mode: 'vod', calib: null, autosync: null, err: '', needMic: false });
    lastWelcome = null; snap(true);
    if (OFFSCREEN) chrome.runtime.sendMessage({ to: 'bg', cmd: 'engineIdle' }).catch(() => {});
  }
  async function getMic() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      S.needMic = false;
    } catch { localStream = null; S.needMic = true; }
    snap();
  }
  async function reconnectWithMic() {
    await getMic(); if (!localStream) return;
    for (const [id, p] of peers) if (p.kind === 'salon' && id !== S.me.id) { p.pc?.close(); p.pc = null; await call(id); }
    watchLevel(S.me.id, localStream); applyMic(); sys('Micro activé');
  }

  const wsUrl = () => { const u = new URL(S.server); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; u.pathname = '/'; return u.toString(); };
  const sendS = o => wsS?.readyState === 1 && wsS.send(JSON.stringify(o));
  const sendP = o => wsP?.readyState === 1 && wsP.send(JSON.stringify(o));

  function connectSalon() {
    wsS = new WebSocket(wsUrl());
    wsS.onopen = () => { sendS({ t: 'join', room: S.code, name: S.me.name, kind: 'salon', avatar: myAvatar || undefined }); clearInterval(pingS); pingS = setInterval(() => sendS({ t: 'ping' }), 30000); };
    wsS.onerror = () => { if (!S.me?.id) { S.err = 'Le serveur se réveille, nouvel essai automatique…'; snap(); } };
    wsS.onclose = () => {
      clearInterval(pingS); if (!S.code) return;
      const d = Math.min(1000 * 2 ** retryS++, 10000); reconnectingS = !!S.me?.id;
      if (S.me?.id) sys(`Connexion perdue, reconnexion dans ${Math.round(d / 1000)} s…`);
      setTimeout(() => { if (S.code) connectSalon(); }, d);
    };
    wsS.onmessage = async ev => {
      const m = JSON.parse(ev.data);
      if (m.t === 'error') { S.err = m.msg; snap(); return; }
      if (m.t === 'welcome') {
        retryS = 0; S.err = '';
        if (reconnectingS) { peers.forEach(p => { p.pc?.close(); p.audio?.remove(); }); peers.clear(); reconnectingS = false; }
        const first = !S.me.id;
        S.me.id = m.id; S.me.name = m.name || S.me.name; S.code = m.room;
        if (first) connectPlayer();
        peers.set(S.me.id, { id: S.me.id, name: S.me.name, kind: 'salon', avatar: myAvatar, self: true, state: 'connected' });
        if (localStream) { watchLevel(S.me.id, localStream); applyMic(); }
        for (const p of m.peers) { peers.set(p.id, { ...p }); if (p.kind === 'salon') await call(p.id); }
        S.mode = m.mode === 'live' ? 'live' : 'vod';
        if (first) sys(`Tu es dans le salon ${S.code}. Envoie l'invitation à tes amis.`);
        pushRoster(); autoMode(); snap(true);
      }
      if (m.t === 'peer-joined') { peers.set(m.peer.id, { ...m.peer }); if (m.peer.kind === 'salon') { sys(`${m.peer.name} est arrivé`); pushRoster(); } snap(); }
      if (m.t === 'avatar') { const p = peers.get(m.id); if (p) { p.avatar = m.avatar || null; pushRoster(); snap(); } }
      if (m.t === 'peer-left') { const p = peers.get(m.id); if (p) { p.pc?.close(); p.audio?.remove(); peers.delete(m.id); if (p.kind === 'salon') { sys(`${p.name} est parti`); pushRoster(); } snap(); } }
      if (m.t === 'signal') await onSignal(m.from, m.data);
      if (m.t === 'chat') addLog({ kind: 'msg', name: m.name, text: m.text, at: m.at || Date.now() });
      if (m.t === 'chat-history') m.items.forEach(it => addLog({ kind: 'msg', name: it.name, text: it.text, at: it.at }));
      if (m.t === 'reaction') addLog({ kind: 'msg', name: m.name, text: m.emoji, at: Date.now() });
      if (m.t === 'mode') { S.mode = m.mode === 'live' ? 'live' : 'vod'; sys(S.mode === 'live' ? 'Match en direct : calage automatique activé.' : 'Série / replay : lecture partagée.'); snap(); }
      if (m.t === 'calib-start') { S.calib = { id: m.id, label: m.label, myTop: false, items: [], msg: `Appuie quand tu vois : ${m.label}` }; snap(); }
      if (m.t === 'calib-result') { if (!S.calib || S.calib.id !== m.id) S.calib = { id: m.id, label: m.label, myTop: true, items: [], msg: '' }; S.calib.items = m.items; snap(); }
      if (m.t === 'align' && m.name === S.me.name) {
        const txt = `Ta vidéo se met en pause ${m.pauseFor} s pour se caler sur les autres.`;
        if (m.auto) { S.autosync = { ...(S.autosync || {}), mine: m.pauseFor, at: Date.now() }; } else if (S.calib) S.calib.msg = txt;
        snap();
      }
      if (m.t === 'aligned') { if (S.calib) S.calib.done = true; snap(); }
      if (m.t === 'autosync') {
        S.autosync = { at: Date.now(), spread: m.spread, items: m.items, reason: m.reason, who: m.who, mine: (m.items.find(i => i.name === S.me.name) || {}).ahead || 0 };
        if (m.reason === 'arrival') sys(m.spread > 0.6 ? `${m.who} est arrivé : salon recalé (écart corrigé ${m.spread.toFixed(1)} s).` : `${m.who} est arrivé : déjà calé ✓`);
        else if (m.reason === 'drift') sys(`Petit décalage détecté : salon recalé (${m.spread.toFixed(1)} s).`);
        snap();
      }
      if (m.t === 'autosync-stuck') { sys('Le calage automatique n\'arrive pas à tenir (le lecteur revient peut-être tout seul au direct). Utilisez le calage manuel (TOP).'); snap(); }
    };
  }
  function connectPlayer() {
    wsP = new WebSocket(wsUrl());
    wsP.onopen = () => { sendP({ t: 'join', room: S.code, name: S.me.name, kind: 'player' }); clearInterval(pingP); pingP = setInterval(() => sendP({ t: 'ping' }), 20000); };
    wsP.onclose = () => { clearInterval(pingP); if (!S.code) return; const d = Math.min(1000 * 2 ** retryP++, 10000); setTimeout(() => { if (S.code) connectPlayer(); }, d); };
    wsP.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.t === 'welcome') { retryP = 0; lastWelcome = { t: 'welcome', id: m.id, host: m.host, offset: m.serverTime - Date.now(), mode: m.mode }; toTab(lastWelcome); }
      else if (m.t === 'host') { if (lastWelcome) lastWelcome.host = m.id; toTab(m); }
      else if (['sync', 'state-request', 'mode', 'align', 'chat', 'reaction'].includes(m.t)) toTab(m);
    };
  }
  // Mode choisi automatiquement : direct (match) ou replay / série, selon la vidéo de l'onglet.
  function autoMode() { if (S.code && S.me?.id && S.live != null && (S.live ? 'live' : 'vod') !== S.mode) sendS({ t: 'mode', mode: S.live ? 'live' : 'vod' }); }

  // ---------- Voix (WebRTC pair à pair) ----------
  function makePC(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream)); else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = e => e.candidate && sendS({ t: 'signal', to: id, data: { ice: e.candidate } });
    pc.ontrack = e => {
      const p = peers.get(id); if (!p) return;
      if (!p.audio) { p.audio = new Audio(); p.audio.autoplay = true; document.body.append(p.audio); }
      p.audio.srcObject = e.streams[0] || new MediaStream([e.track]); p.audio.play().catch(() => {});
      watchLevel(id, p.audio.srcObject);
    };
    pc.onconnectionstatechange = () => {
      const p = peers.get(id); if (p) p.state = pc.connectionState; snap();
      if (pc.connectionState === 'failed') sys(`Voix impossible avec ${p?.name || 'un participant'} : réseau trop restrictif (souvent la 4G). Le chat fonctionne.`);
    };
    peers.get(id).pc = pc; return pc;
  }
  async function call(id) { const pc = makePC(id); await pc.setLocalDescription(await pc.createOffer()); sendS({ t: 'signal', to: id, data: { sdp: pc.localDescription } }); }
  async function onSignal(from, data) {
    const p = peers.get(from); if (!p) return;
    if (data.sdp) {
      if (data.sdp.type === 'offer' && p.pc) { p.pc.close(); p.pc = null; }
      const pc = p.pc || makePC(from);
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); sendS({ t: 'signal', to: from, data: { sdp: pc.localDescription } }); }
    } else if (data.ice && p.pc) { try { await p.pc.addIceCandidate(data.ice); } catch {} }
  }
  let actx;
  const watched = new Map();
  function watchLevel(id, stream) {
    try {
      clearInterval(watched.get(id));
      actx = actx || new AudioContext(); actx.resume?.().catch(() => {});
      const an = actx.createAnalyser(); an.fftSize = 512; actx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize); let on = false, lastLoud = 0;
      const timer = setInterval(() => {
        const p = peers.get(id); if (!p) { clearInterval(timer); return; }
        an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += (v - 128) ** 2;
        const loud = Math.sqrt(s / buf.length) > 6 && !(id === S.me?.id && S.muted), now = Date.now();
        if (loud) lastLoud = now;
        const next = loud || now - lastLoud < 700;
        if (next !== on) { on = next; p.speaking = on; EMIT({ ev: 'speak', id, on }); toTab({ t: 'speak', id, on }); }
      }, 100);
      watched.set(id, timer);
    } catch {}
  }
  function applyMic() { localStream?.getAudioTracks().forEach(t => t.enabled = !S.muted); pushRoster(); snap(); }
})();
