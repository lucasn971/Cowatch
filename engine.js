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
    joining: false, wake: false, micErr: '', noAutoClock: false,
  };
  // Identifiant stable de ce navigateur : si on se reconnecte, le serveur remplace l'ancienne présence (plus de « Lucas 2 »).
  let CID = ''; try { CID = localStorage.getItem('cowatchCid') || ''; } catch {}
  if (!CID) { CID = crypto.randomUUID(); try { localStorage.setItem('cowatchCid', CID); } catch {} }
  let wsS = null, wsP = null, localStream = null, lastWelcome = null, myAvatar = null;
  let retryS = 0, retryP = 0, pingS = null, pingP = null, timerS = null, timerP = null;
  let micReady = Promise.resolve(), iceReady = Promise.resolve(), outbox = [];
  const goneTimers = new Map(); let lostTimer = null, lostShown = false; // annonces d'arrivée / départ sans bruit lors des micro-coupures
  const seen = new Set(); // messages déjà affichés (évite les doublons après une reconnexion)
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
      case 'chat': { // si la connexion est coupée, le message part dès le retour
        const v = String(m.text || '').trim(); if (!v || !S.code) break;
        if (!sendS({ t: 'chat', text: v })) { outbox.push({ t: 'chat', text: v }); sys('Message en attente : reconnexion…'); }
        break;
      }
      case 'reaction': sendS({ t: 'reaction', emoji: m.emoji }); break;
      case 'mute': S.muted = m.value != null ? !!m.value : !S.muted; applyMic(); if (m.toast) toTab({ t: 'toast', text: S.muted ? 'Micro coupé' : 'Micro activé' }); break;
      case 'avatar': myAvatar = m.avatar || null; sendS({ t: 'avatar', avatar: myAvatar }); pushRoster(); break;
      case 'calibStart': sendS({ t: 'calib-start', label: 'le score change à l\'écran (ou le prochain coup de sifflet)' }); break;
      case 'top': if (S.calib && !S.calib.myTop) { S.calib.myTop = true; sendS({ t: 'top', id: S.calib.id }); snap(); } break;
      case 'align': sendS({ t: 'align' }); break;
      case 'micGranted': if (S.code && !localStream) reconnectWithMic(); break;
    }
  }

  // ---------- Messages venant de l'onglet (content script) ----------
  function fromTab(m) {
    if (m.cmd === 'sync') sendP({ t: 'sync', action: m.action, time: m.time, playing: m.playing, rate: m.rate });
    if (m.cmd === 'clock') {
      sendP({ t: 'clock', pos: m.pos, paused: m.paused });
      // Le calage automatique a besoin de l'heure réelle de l'image (Canal+ la donne, TF1 non).
      const no = !(Number(m.pos) > 1e8); if (no !== S.noAutoClock) { S.noAutoClock = no; snap(); }
    }
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
    const code = String(m.code || '').toUpperCase();
    if (!code) return;
    if (S.code === code && S.me) { snap(true); return; } // déjà dans ce salon (ou en train d'y entrer) : on ignore le double clic
    if (S.code) leave(true);
    S.server = m.server; S.tabId = m.tabId ?? S.tabId; myAvatar = m.avatar || null; S.err = '';
    S.me = { name: m.name }; S.code = code; S.joining = true; S.wake = false;
    retryS = retryP = 0; outbox = []; snap();
    // Micro et serveurs de voix en parallèle : la connexion au salon n'attend pas.
    micReady = getMic();
    iceReady = Promise.race([
      fetch(S.server.replace(/\/$/, '') + '/ice').then(r => r.json()).then(j => { if (j.iceServers) ICE = j.iceServers; }).catch(() => {}),
      new Promise(r => setTimeout(r, 6000)),
    ]);
    connectSalon();
  }
  function closeWs(ws) { if (!ws) return; ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null; try { ws.close(); } catch {} }
  function leave(quiet) {
    S.code = null; clearInterval(pingS); clearInterval(pingP); clearTimeout(timerS); clearTimeout(timerP);
    closeWs(wsS); closeWs(wsP); wsS = wsP = null;
    peers.forEach(p => { p.pc?.close(); p.audio?.remove(); }); peers.clear(); log.length = 0; seen.clear(); outbox = [];
    goneTimers.forEach(clearTimeout); goneTimers.clear(); clearTimeout(lostTimer); lostShown = false;
    localStream?.getTracks().forEach(t => t.stop()); localStream = null;
    toTab({ t: 'disconnected' });
    Object.assign(S, { me: null, mode: 'vod', calib: null, autosync: null, err: '', needMic: false, micErr: '', joining: false, wake: false });
    lastWelcome = null; if (!quiet) snap(true);
    // Le moteur reste ouvert : on peut recréer ou rejoindre un salon tout de suite.
  }
  async function getMic() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      S.needMic = false; S.micErr = '';
    } catch (e) { localStream = null; S.needMic = true; S.micErr = (e && e.name) || 'Error'; }
    snap();
  }
  async function reconnectWithMic() {
    micReady = getMic(); await micReady; if (!localStream || !S.me?.id) return;
    for (const [id, p] of peers) if (p.kind === 'salon' && id !== S.me.id) { p.pc?.close(); p.pc = null; await call(id); }
    watchLevel(S.me.id, localStream); applyMic(); sys('Micro activé');
  }

  const wsUrl = () => { const u = new URL(S.server); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; u.pathname = '/'; return u.toString(); };
  const sendS = o => { if (wsS?.readyState !== 1 || !wsS.ok) return false; wsS.send(JSON.stringify(o)); return true; };
  const sendP = o => { if (wsP?.readyState !== 1) return false; wsP.send(JSON.stringify(o)); return true; };
  const backoff = n => Math.min(1000 * 2 ** n, 8000);
  function addMsg(it) { // un message n'est affiché qu'une fois, même renvoyé après une reconnexion
    const k = `${it.at}|${it.name}|${it.text}`; if (seen.has(k)) return; seen.add(k);
    addLog({ kind: 'msg', name: it.name, text: it.text, at: it.at || Date.now() });
  }

  function connectSalon() {
    clearTimeout(timerS); closeWs(wsS);
    const ws = wsS = new WebSocket(wsUrl());
    // Serveur gratuit endormi : il met jusqu'à ~30 s à se réveiller. On le dit au lieu de rester muet.
    const slow = setTimeout(() => { if (ws === wsS && S.joining) { S.wake = true; snap(); } }, 2500);
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'join', room: S.code, name: S.me.name, kind: 'salon', cid: CID, avatar: myAvatar || undefined }));
      clearInterval(pingS); pingS = setInterval(() => sendS({ t: 'ping' }), 30000);
    };
    ws.onclose = () => {
      clearTimeout(slow); clearInterval(pingS); if (ws !== wsS || !S.code) return;
      const d = backoff(retryS++);
      if (S.me?.id && !S.joining) {
        S.joining = true; snap();
        clearTimeout(lostTimer); lostTimer = setTimeout(() => { if (S.joining && S.code) { lostShown = true; sys('Connexion perdue, reconnexion…'); } }, 4000);
      }
      timerS = setTimeout(() => { if (S.code && ws === wsS) connectSalon(); }, d);
    };
    ws.onmessage = async ev => {
      if (ws !== wsS) return;
      const m = JSON.parse(ev.data);
      if (m.t === 'error') { S.err = m.msg; S.joining = false; snap(); return; }
      if (m.t === 'welcome') {
        clearTimeout(slow); retryS = 0; S.err = ''; S.wake = false; ws.ok = true;
        const first = !S.me.id, back = !first && S.joining; S.joining = false;
        // Liste des présents donnée par le serveur : on repart d'elle (pas de fantôme après une reconnexion).
        peers.forEach(p => { p.pc?.close(); p.audio?.remove(); }); peers.clear();
        S.me.id = m.id; S.me.name = m.name || S.me.name; S.code = m.room;
        if (!wsP) connectPlayer();
        peers.set(S.me.id, { id: S.me.id, name: S.me.name, kind: 'salon', avatar: myAvatar, self: true, state: 'connected' });
        for (const p of m.peers) peers.set(p.id, { ...p });
        S.mode = m.mode === 'live' ? 'live' : 'vod';
        clearTimeout(lostTimer);
        if (first) sys(`Tu es dans le salon ${S.code}.`); else if (back && lostShown) sys('Reconnecté ✓');
        lostShown = false;
        pushRoster(); autoMode(); snap(true);
        const q = outbox; outbox = []; q.forEach(sendS);
        await micReady; if (localStream) { watchLevel(S.me.id, localStream); applyMic(); }
        for (const p of m.peers) if (p.kind === 'salon' && peers.has(p.id)) await call(p.id);
        return;
      }
      if (m.t === 'peer-joined') {
        peers.set(m.peer.id, { ...m.peer });
        if (m.peer.kind === 'salon') {
          const t = goneTimers.get(m.peer.name); // parti puis revenu en quelques secondes : on ne dit rien
          if (t) { clearTimeout(t); goneTimers.delete(m.peer.name); } else sys(`${m.peer.name} est arrivé`);
          pushRoster();
        }
        snap();
      }
      if (m.t === 'avatar') { const p = peers.get(m.id); if (p) { p.avatar = m.avatar || null; pushRoster(); snap(); } }
      if (m.t === 'peer-left') { const p = peers.get(m.id); if (p) { p.pc?.close(); p.audio?.remove(); peers.delete(m.id); if (p.kind === 'salon') { const n = p.name; clearTimeout(goneTimers.get(n)); goneTimers.set(n, setTimeout(() => { goneTimers.delete(n); sys(`${n} est parti`); }, 10000)); pushRoster(); } snap(); } }
      if (m.t === 'signal') await onSignal(m.from, m.data);
      if (m.t === 'chat') addMsg(m);
      if (m.t === 'chat-history') m.items.forEach(addMsg);
      // Réactions : seulement en surimpression sur la vidéo (pas dans le chat, sinon elles noient les messages).
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
    clearTimeout(timerP); closeWs(wsP);
    const ws = wsP = new WebSocket(wsUrl());
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', room: S.code, name: S.me.name, kind: 'player', cid: CID })); clearInterval(pingP); pingP = setInterval(() => sendP({ t: 'ping' }), 20000); };
    ws.onclose = () => { clearInterval(pingP); if (ws !== wsP || !S.code) return; timerP = setTimeout(() => { if (S.code && ws === wsP) connectPlayer(); }, backoff(retryP++)); };
    ws.onmessage = ev => {
      if (ws !== wsP) return;
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
  async function call(id) {
    await Promise.all([micReady, iceReady]); if (!peers.has(id)) return;
    const pc = makePC(id); await pc.setLocalDescription(await pc.createOffer()); sendS({ t: 'signal', to: id, data: { sdp: pc.localDescription } }); }
  async function onSignal(from, data) {
    const p = peers.get(from); if (!p) return;
    if (data.sdp) {
      if (data.sdp.type === 'offer') { await Promise.all([micReady, iceReady]); if (!peers.has(from)) return; if (p.pc) { p.pc.close(); p.pc = null; } }
      const pc = p.pc || makePC(from);
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); sendS({ t: 'signal', to: from, data: { sdp: pc.localDescription } }); }
      const q = p.pendingIce || []; p.pendingIce = []; for (const c of q) { try { await pc.addIceCandidate(c); } catch {} }
    } else if (data.ice) { // candidats arrivés avant la description : gardés de côté puis appliqués
      if (p.pc && p.pc.remoteDescription) { try { await p.pc.addIceCandidate(data.ice); } catch {} } else (p.pendingIce = p.pendingIce || []).push(data.ice);
    }
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
