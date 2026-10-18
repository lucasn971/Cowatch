// Panneau latéral Salon : salon vocal + chat + réactions + synchro du lecteur de l'onglet.
// Deux connexions au serveur : "salon" (voix, chat, calibration) et "player" (commandes de lecture),
// ce qui garde le même protocole que la page web du salon (les amis sur téléphone restent compatibles).
const DEFAULT_SERVER = 'https://salon-coche-private.onrender.com';
let ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const EMOJIS = ['😂', '😱', '🔥', '💀', '👀', '😍', '⚽', '👏'];
const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);

let server = DEFAULT_SERVER, me = null, code = null, tabId = null, wsS = null, wsP = null;
let localStream = null, muted = false, pttHeld = false, mode = 'vod', calibId = null, myTop = false, lastWelcome = null;
const peers = new Map(); // id -> {name, kind, pc, audio, el}

// ---------- Démarrage ----------
(async () => {
  const st = await chrome.storage.local.get(['name', 'server']);
  if (st.server) server = st.server;
  if (params.get('server')) server = params.get('server');
  $('#name').value = st.name || '';
  tabId = params.get('tab') ? Number(params.get('tab')) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  for (const em of EMOJIS) { const b = document.createElement('button'); b.textContent = em; b.onclick = () => sendS({ t: 'reaction', emoji: em }); $('#react').append(b); }
  const { pendingJoin } = await chrome.storage.local.get('pendingJoin');
  if (pendingJoin && Date.now() - pendingJoin.at < 30 * 60 * 1000) {
    $('#codeIn').value = pendingJoin.code;
    await chrome.storage.local.remove('pendingJoin');
    if ($('#name').value.trim()) join(pendingJoin.code);
    else { $('#err').textContent = 'Choisis un pseudo puis clique sur Rejoindre.'; $('#name').focus(); }
  }
  toTab({ t: 'ping-video' });
})();

function randomCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(5)), x => a[x % a.length]).join(''); }
$('#create').onclick = () => join(randomCode());
$('#joinBtn').onclick = () => { const c = $('#codeIn').value.trim().toUpperCase(); if (c) join(c); else $('#err').textContent = 'Entre un code de salon.'; };
$('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });

async function join(c) {
  const name = $('#name').value.trim();
  if (!name) { $('#err').textContent = 'Choisis un pseudo.'; $('#name').focus(); return; }
  await chrome.storage.local.set({ name });
  $('#err').textContent = '';
  await getMic();
  try { const j = await (await fetch(server.replace(/\/$/, '') + '/ice')).json(); if (j.iceServers) ICE = j.iceServers; } catch {}
  me = { name }; code = c.toUpperCase();
  connectSalon(); // le lecteur se connecte après l'accueil, avec le pseudo définitif
}

async function getMic() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    $('#micFix').classList.add('hidden');
  } catch (e) {
    localStream = null;
    $('#micFix').classList.remove('hidden'); // le panneau ne peut pas afficher la demande : on passe par un onglet
  }
}
$('#micFix').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') });
chrome.runtime.onMessage.addListener((m, sender) => {
  if (m.cmd === 'micGranted' && code) reconnectWithMic();
  if (sender.tab && sender.tab.id === tabId) fromTab(m);
});
async function reconnectWithMic() {
  await getMic(); if (!localStream) return;
  // On rappelle chacun avec le micro.
  for (const [id, p] of peers) if (p.kind === 'salon' && id !== me.id) { p.pc?.close(); p.pc = null; await call(id); }
  sys('Micro activé');
}

const wsUrl = () => { const u = new URL(server); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; u.pathname = '/'; return u.toString(); };
const sendS = o => wsS?.readyState === 1 && wsS.send(JSON.stringify(o));
const sendP = o => wsP?.readyState === 1 && wsP.send(JSON.stringify(o));
const toTab = m => { if (tabId != null) chrome.tabs.sendMessage(tabId, m).catch(() => {}); };

// ---------- Connexion "salon" : voix, chat, réactions, calibration ----------
let retryS = 0, retryP = 0, pingS = null, pingP = null, reconnectingS = false;
function connectSalon() {
  wsS = new WebSocket(wsUrl());
  wsS.onopen = () => { sendS({ t: 'join', room: code, name: me.name, kind: 'salon' }); clearInterval(pingS); pingS = setInterval(() => sendS({ t: 'ping' }), 30000); };
  wsS.onerror = () => { if (!me.id) $('#err').textContent = 'Le serveur se réveille, nouvel essai automatique…'; };
  wsS.onclose = () => {
    clearInterval(pingS); if (!code) return;
    const d = Math.min(1000 * 2 ** retryS++, 10000); reconnectingS = !!me.id;
    if (me.id) sys(`Connexion perdue, reconnexion dans ${Math.round(d / 1000)} s…`);
    setTimeout(() => { if (code) connectSalon(); }, d);
  };
  wsS.onmessage = async ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'error') { $('#err').textContent = m.msg; return; }
    if (m.t === 'welcome') {
      retryS = 0; $('#err').textContent = '';
      if (reconnectingS) { peers.forEach(p => { p.pc?.close(); p.el?.remove(); p.audio?.remove(); }); peers.clear(); $('#peers').innerHTML = ''; reconnectingS = false; }
      const first = !me.id;
      me.id = m.id; me.name = m.name || me.name; code = m.room;
      if (first) connectPlayer();
      $('#home').classList.add('hidden'); $('#room').classList.remove('hidden'); $('#code').textContent = code;
      addPeer({ id: me.id, name: me.name + ' (toi)', kind: 'salon' }, true);
      if (localStream) watchLevel(me.id, localStream);
      for (const p of m.peers) { addPeer(p); if (p.kind === 'salon') await call(p.id); }
      setMode(m.mode); sys(`Tu es dans le salon ${code}. Envoie l'invitation à tes amis.`);
    }
    if (m.t === 'peer-joined') { addPeer(m.peer); if (m.peer.kind === 'salon') sys(`${m.peer.name} est arrivé`); }
    if (m.t === 'peer-left') { const p = peers.get(m.id); if (p) { p.pc?.close(); p.el?.remove(); p.audio?.remove(); peers.delete(m.id); if (p.kind === 'salon') sys(`${p.name} est parti`); } }
    if (m.t === 'signal') await onSignal(m.from, m.data);
    if (m.t === 'chat') addChat(m);
    if (m.t === 'chat-history') m.items.forEach(addChat);
    if (m.t === 'reaction') { addChat({ name: m.name, text: m.emoji, at: Date.now() }); }
    if (m.t === 'mode') { setMode(m.mode); sys(`${m.by} passe en mode ${m.mode === 'live' ? 'match en direct' : 'série / film'}`); }
    if (m.t === 'calib-start') { calibId = m.id; myTop = false; $('#top').classList.remove('hidden'); $('#top').disabled = false; $('#top').textContent = 'TOP !'; $('#cMsg').textContent = `Appuie quand tu vois : ${m.label}`; $('#cRes').innerHTML = ''; $('#align').classList.add('hidden'); }
    if (m.t === 'calib-result') showCalib(m);
    if (m.t === 'align' && m.name === me.name) $('#cMsg').textContent = lastWelcome ? `Ta vidéo se met en pause ${m.pauseFor} s pour s'aligner.` : `Tu as ${m.pauseFor} s d'avance : mets pause ${Math.round(m.pauseFor)} s.`;
    if (m.t === 'aligned') { $('#top').classList.add('hidden'); if (!$('#cMsg').textContent.startsWith('Ta vidéo') && !$('#cMsg').textContent.startsWith('Tu as')) $('#cMsg').textContent = 'Tu es le plus en retard : les autres se calent sur toi.'; }
  };
}

// ---------- Connexion "player" : relais des commandes de lecture vers l'onglet ----------
function connectPlayer() {
  wsP = new WebSocket(wsUrl());
  wsP.onopen = () => { sendP({ t: 'join', room: code, name: me.name, kind: 'player' }); clearInterval(pingP); pingP = setInterval(() => sendP({ t: 'ping' }), 20000); };
  wsP.onclose = () => { clearInterval(pingP); if (!code) return; const d = Math.min(1000 * 2 ** retryP++, 10000); setTimeout(() => { if (code) connectPlayer(); }, d); };
  wsP.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'welcome') { retryP = 0; lastWelcome = { t: 'welcome', id: m.id, host: m.host, offset: m.serverTime - Date.now(), mode: m.mode }; toTab(lastWelcome); }
    else if (m.t === 'host') { if (lastWelcome) lastWelcome.host = m.id; toTab(m); }
    else if (['sync', 'state-request', 'mode', 'align', 'chat', 'reaction'].includes(m.t)) toTab(m);
  };
}
function fromTab(m) {
  if (m.cmd === 'sync') sendP({ t: 'sync', action: m.action, time: m.time, playing: m.playing, rate: m.rate });
  if (m.cmd === 'hello' && lastWelcome) toTab(lastWelcome); // l'onglet a rechargé la page : on lui redonne le salon
  if (m.cmd === 'video') { $('#playerStatus').textContent = m.found ? 'Vidéo détectée ✓' : 'Aucune vidéo détectée'; $('#playerStatus').classList.toggle('ok', !!m.found); }
}

// ---------- Voix (WebRTC pair à pair) ----------
function addPeer(p, self = false) {
  if (peers.has(p.id)) return;
  const entry = { ...p };
  if (p.kind === 'salon') {
    const el = document.createElement('div'); el.className = 'peer' + (self ? ' on' : '');
    const d = document.createElement('span'); d.className = 'd'; const n = document.createElement('span'); n.textContent = p.name;
    el.append(d, n); $('#peers').append(el); entry.el = el;
  }
  peers.set(p.id, entry);
}
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
  pc.onconnectionstatechange = () => { const p = peers.get(id); p?.el?.classList.toggle('on', pc.connectionState === 'connected'); if (p?.el) p.el.dataset.state = pc.connectionState; if (pc.connectionState === 'failed') sys(`Voix impossible avec ${p?.name || 'un participant'} : réseau trop restrictif (souvent la 4G). Le chat fonctionne.`); };
  peers.get(id).pc = pc; return pc;
}
async function call(id) { const pc = makePC(id); await pc.setLocalDescription(await pc.createOffer()); sendS({ t: 'signal', to: id, data: { sdp: pc.localDescription } }); }
async function onSignal(from, data) {
  const p = peers.get(from); if (!p) return;
  if (data.sdp) {
    if (data.sdp.type === 'offer' && p.pc) { p.pc.close(); p.pc = null; } // renégociation (micro activé plus tard)
    const pc = p.pc || makePC(from);
    await pc.setRemoteDescription(data.sdp);
    if (data.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); sendS({ t: 'signal', to: from, data: { sdp: pc.localDescription } }); }
  } else if (data.ice && p.pc) { try { await p.pc.addIceCandidate(data.ice); } catch {} }
}
let actx;
function watchLevel(id, stream) {
  try {
    actx = actx || new AudioContext(); const an = actx.createAnalyser(); an.fftSize = 512; actx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => { const p = peers.get(id); if (!p) return; an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += (v - 128) ** 2;
      p.el?.classList.toggle('speaking', Math.sqrt(s / buf.length) > 6 && !(id === me.id && micOff())); requestAnimationFrame(tick); };
    tick();
  } catch {}
}
const micOff = () => muted || ($('#ptt').checked && !pttHeld);
function applyMic() { localStream?.getAudioTracks().forEach(t => t.enabled = !micOff()); $('#mute').textContent = muted ? 'Réactiver le micro' : 'Couper le micro'; }
$('#mute').onclick = () => { muted = !muted; applyMic(); };
$('#ptt').onchange = applyMic;
addEventListener('keydown', e => { if (e.code === 'Space' && $('#ptt').checked && e.target.tagName !== 'INPUT') { e.preventDefault(); pttHeld = true; applyMic(); } });
addEventListener('keyup', e => { if (e.code === 'Space') { pttHeld = false; applyMic(); } });

// ---------- Chat ----------
function addChat(m) {
  const d = document.createElement('div'); d.className = 'msg';
  const t = document.createElement('span'); t.className = 't'; t.textContent = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const b = document.createElement('b'); b.textContent = m.name === me?.name ? 'Toi' : m.name;
  const x = document.createElement('span'); x.textContent = m.text; // jamais de HTML
  d.append(t, b, x); $('#chat').append(d); $('#chat').scrollTop = $('#chat').scrollHeight;
}
function sys(text) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = text; $('#chat').append(d); $('#chat').scrollTop = $('#chat').scrollHeight; }
function sendChat() { const v = $('#chatIn').value.trim(); if (!v) return; sendS({ t: 'chat', text: v }); $('#chatIn').value = ''; }
$('#send').onclick = sendChat;
$('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

// ---------- Invitation ----------
$('#invite').onclick = async () => {
  let target = '';
  try { const tab = await chrome.tabs.get(tabId); target = tab.url || ''; } catch {}
  const link = `${server.replace(/\/$/, '')}/j/${code}` + (target ? `?u=${encodeURIComponent(target)}` : '');
  try { await navigator.clipboard.writeText(link); $('#invite').textContent = 'Lien copié ✓'; setTimeout(() => $('#invite').textContent = "Copier l'invitation", 2000); }
  catch { sys(`Lien d'invitation : ${link}`); }
};

// ---------- Mode série / match, calibration ----------
function setMode(md) {
  mode = md === 'live' ? 'live' : 'vod';
  $('#mVod').classList.toggle('on', mode === 'vod'); $('#mLive').classList.toggle('on', mode === 'live');
  $('#calib').classList.toggle('hidden', mode !== 'live');
}
$('#mVod').onclick = () => sendS({ t: 'mode', mode: 'vod' });
$('#mLive').onclick = () => sendS({ t: 'mode', mode: 'live' });
$('#cStart').onclick = () => sendS({ t: 'calib-start', label: 'le score change à l\'écran (ou le prochain coup de sifflet)' });
$('#top').onclick = () => { if (myTop) return; myTop = true; sendS({ t: 'top', id: calibId }); $('#top').disabled = true; $('#top').textContent = 'TOP enregistré ✓'; };
$('#align').onclick = () => sendS({ t: 'align' });
function showCalib(m) {
  const box = $('#cRes'); box.innerHTML = '';
  for (const it of m.items) {
    const d = document.createElement('div'); d.className = 'res';
    const n = document.createElement('span'); n.textContent = it.name;
    const v = document.createElement('span'); v.textContent = it.advance < 0.3 ? 'référence' : `${it.advance.toFixed(1)} s d'avance`;
    d.append(n, v); box.append(d);
  }
  $('#align').classList.toggle('hidden', m.items.length < 2);
}

// ---------- Quitter ----------
$('#leave').onclick = () => { code = null; clearInterval(pingS); clearInterval(pingP); wsS?.close(); wsP?.close(); peers.forEach(p => { p.pc?.close(); p.audio?.remove(); }); location.reload(); };
