// Panneau Cowatch : interface seulement. Le moteur (voix, connexions, synchro) tourne à part
// (document caché sur Chrome / Edge / Brave), ce qui permet de ranger le panneau sans couper la voix.
const DEFAULT_SERVER = 'https://salon-coche-private.onrender.com';
const EMOJIS = ['😂', '😱', '🔥', '💀', '👀', '😍', '⚽', '👏'];
const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);

let server = DEFAULT_SERVER, tabId = null, myAvatar = null, st = null, engineLocal = false, diagParts = [];
let localErr = '', busy = null, busyTimer = null, copiedAt = 0; // busy : bouton qui attend la connexion (« create » ou « join »)

// ---------- Lien avec le moteur ----------
function ui(ev) {
  if (ev.ev === 'snap') { st = ev.state; render(); if (ev.log) { $('#chat').innerHTML = ''; ev.log.forEach(addLog); } }
  if (ev.ev === 'log') addLog(ev.item);
  if (ev.ev === 'speak') { document.querySelector(`.peer[data-id="${CSS.escape(ev.id)}"]`)?.classList.toggle('speaking', ev.on); }
}
function engine(cmd) {
  if (engineLocal) return self.__cowatchEngine.handle(cmd);
  return chrome.runtime.sendMessage({ to: 'engine', ...cmd }).catch(() => {});
}
async function startEngine() {
  if (engineLocal) return;
  const r = await chrome.runtime.sendMessage({ to: 'bg', cmd: 'ensureEngine' }).catch(() => null);
  if (r && r.ok) return;
  // Pas de document caché possible (Firefox, Opera) : le moteur tourne dans le panneau.
  engineLocal = true; self.__cowatchEmit = ui;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'engine.js'; s.onload = res; s.onerror = rej; document.body.append(s); });
}

// ---------- Démarrage ----------
(async () => {
  const saved = await chrome.storage.local.get(['name', 'server', 'avatar']);
  if (saved.server) server = saved.server;
  if (params.get('server')) server = params.get('server');
  fetch(server.replace(/\/$/, '') + '/health').catch(() => {}); // réveille le serveur gratuit pendant qu'on tape son pseudo
  $('#name').value = saved.name || ''; myAvatar = saved.avatar || null; renderMyAvatar();
  tabId = params.get('tab') ? Number(params.get('tab')) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  for (const em of EMOJIS) { const b = document.createElement('button'); b.textContent = em; b.onclick = () => engine({ cmd: 'reaction', emoji: em }); $('#react').append(b); }
  chrome.runtime.onMessage.addListener((m, sender) => {
    if (m.to === 'ui') ui(m);
    if (sender.tab && sender.tab.id === tabId && m.cmd === 'diag') diagParts.push(m.data);
  });
  await startEngine();
  await engine({ cmd: 'hello', tabId });
  chrome.tabs.sendMessage(tabId, { t: 'ping-video' }).catch(() => {});
  const { pendingJoin } = await chrome.storage.local.get('pendingJoin');
  if (pendingJoin && Date.now() - pendingJoin.at < 30 * 60 * 1000 && !(st && st.inRoom)) {
    $('#codeIn').value = pendingJoin.code;
    await chrome.storage.local.remove('pendingJoin');
    if ($('#name').value.trim()) join(pendingJoin.code, 'join');
    else showErr('Choisis un pseudo puis clique sur Rejoindre.', '#name');
  }
})();

function randomCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(5)), x => a[x % a.length]).join(''); }
// Accepte le lien d'invitation complet (…/j/CODE?u=…) ou le code seul.
function codeFrom(v) { v = (v || '').trim(); const m = v.match(/\/(?:j|s)\/([A-Za-z0-9-]{3,24})/); return (m ? m[1] : /^[A-Za-z0-9-]{3,24}$/.test(v) ? v : '').toUpperCase(); }
function showErr(msg, field) {
  localErr = msg; $('#err').textContent = msg;
  if (field) { $(field).classList.add('bad'); $(field).focus(); }
}
$('#name').addEventListener('input', () => { $('#name').classList.remove('bad'); if (localErr) showErr(''); });
$('#codeIn').addEventListener('input', () => { $('#codeIn').classList.remove('bad'); if (localErr) showErr(''); });
$('#create').onclick = () => {
  if (busy) return;
  if (!$('#name').value.trim()) return showErr('Choisis un pseudo.', '#name');
  const code = randomCode();
  join(code, 'create', copyInvite(code)); // le lien est copié tout de suite : il n'y a plus qu'à le coller à ses amis
};
$('#joinBtn').onclick = () => { const c = codeFrom($('#codeIn').value); if (c) join(c, 'join'); else showErr('Colle le lien d\'invitation reçu (ou le code du salon).', '#codeIn'); };
$('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });
$('#name').addEventListener('keydown', e => { if (e.key === 'Enter') ($('#codeIn').value.trim() ? $('#joinBtn') : $('#create')).click(); });
function join(code, from, pre) {
  if (busy) return false; // déjà en cours : un 2e clic ne crée pas un 2e salon
  const name = $('#name').value.trim();
  if (!name) { showErr('Choisis un pseudo.', '#name'); return false; }
  showErr(''); busy = from; renderBusy();
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => { if (busy && !(st && st.inRoom)) { busy = null; showErr('Le serveur ne répond pas. Vérifie ta connexion Internet ; Cowatch réessaie tout seul.'); renderBusy(); } }, 60000);
  Promise.resolve(pre).catch(() => {}).then(askMicIfNeeded); // après la copie du lien (la fenêtre du micro prend le focus)
  (async () => {
    await chrome.storage.local.set({ name });
    await startEngine();
    await engine({ cmd: 'join', code, name, avatar: myAvatar, server, tabId });
  })();
  return true;
}
// Micro : la première fois, une petite fenêtre demande l'autorisation (le panneau ne peut pas afficher la question lui-même).
async function askMicIfNeeded() {
  let state = 'prompt';
  try { state = (await navigator.permissions.query({ name: 'microphone' })).state; } catch {}
  if (state === 'granted') return;
  openMicPage();
}
function openMicPage() {
  const url = chrome.runtime.getURL('mic.html');
  if (chrome.windows?.create) chrome.windows.create({ url, type: 'popup', width: 440, height: 320, focused: true }).catch(() => chrome.tabs.create({ url }));
  else chrome.tabs.create({ url });
}
function renderBusy() {
  const joining = st && st.joining && !st.inRoom;
  if (busy && st && !st.joining && !st.inRoom && st.err) busy = null; // échec : on rend la main
  if (st && st.inRoom) { busy = null; clearTimeout(busyTimer); }
  for (const [id, label] of [['create', 'Créer un salon'], ['joinBtn', 'Rejoindre']]) {
    const b = $('#' + id), mine = busy === (id === 'create' ? 'create' : 'join');
    b.disabled = !!busy;
    b.textContent = mine ? (st && st.wake ? 'Réveil du serveur… (≈ 30 s)' : 'Connexion…') : label;
  }
  if (!busy && joining) { $('#create').disabled = true; $('#create').textContent = st.wake ? 'Réveil du serveur… (≈ 30 s)' : 'Connexion…'; }
}

// ---------- Affichage ----------
function colorOf(name) { let h = 0; for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 45% 38%)`; }
function avatarEl(name, src) {
  if (src) { const i = document.createElement('img'); i.className = 'avatar'; i.src = src; i.alt = ''; return i; }
  const s = document.createElement('span'); s.className = 'avatar'; s.textContent = (name || '?').trim().charAt(0).toUpperCase(); s.style.background = colorOf(name); return s;
}
function render() {
  if (!st) return;
  $('#playerStatus').textContent = st.video ? 'Vidéo détectée ✓' : 'Aucune vidéo détectée'; $('#playerStatus').classList.toggle('ok', !!st.video);
  $('#err').textContent = localErr || st.err || '';
  renderBusy();
  $('#home').classList.toggle('hidden', st.inRoom); $('#room').classList.toggle('hidden', !st.inRoom);
  if (!st.inRoom) return;
  $('#code').textContent = st.code;
  $('#invite').textContent = Date.now() - copiedAt < 6000 ? 'Lien copié ✓' : "Copier l'invitation";
  const box = $('#peers'); box.innerHTML = '';
  for (const p of st.peers) {
    const el = document.createElement('div'); el.className = 'peer' + (p.self || p.state === 'connected' ? ' on' : '') + (p.speaking ? ' speaking' : '');
    el.dataset.id = p.id; el.dataset.state = p.self ? 'self' : p.state;
    const n = document.createElement('span'); n.textContent = p.self ? p.name + ' (toi)' : p.name;
    el.append(avatarEl(p.name, p.avatar), n); box.append(el);
  }
  // Un seul bouton micro : « Activer mon micro » tant qu'il n'est pas autorisé, sinon couper / réactiver.
  $('#mute').textContent = st.needMic ? '🎤 Activer mon micro' : st.muted ? 'Réactiver le micro' : 'Couper le micro';
  $('#mute').classList.toggle('need', !!st.needMic);
  $('#micHelp').classList.toggle('hidden', !st.needMic || !st.micErr);
  $('#micHelp').textContent = st.micErr === 'NotFoundError' ? 'Aucun micro trouvé sur cet ordinateur. Branche un casque ou des écouteurs avec micro.'
    : st.micErr === 'NotReadableError' ? 'Le micro est déjà utilisé par une autre application (Zoom, Teams, FaceTime…). Ferme-la puis clique sur « Activer mon micro ».'
    : 'Micro bloqué. Clique sur « Activer mon micro » et réponds « Autoriser ». Sur Mac, vérifie aussi Réglages Système › Confidentialité › Micro › Chrome.';
  $('#net').textContent = st.joining ? 'Reconnexion…' : '';
  // Direct : calage automatique ; le calage manuel (TOP) reste disponible pour ceux qui regardent sur la TV.
  const live = st.mode === 'live';
  $('#calib').classList.toggle('hidden', !live);
  if (live) {
    const a = st.autosync;
    if (st.noAutoClock) $('#manual').open = true;
    $('#autoState').style.color = st.noAutoClock ? 'var(--muted)' : 'var(--ok)';
    $('#autoState').textContent = st.noAutoClock ? 'Calage automatique indisponible sur ce site : utilisez le TOP.'
      : !a ? 'Calage automatique : en attente d\'un 2e lecteur…'
      : a.spread > 0.6 ? `Calé automatiquement ✓ (écart corrigé : ${a.spread.toFixed(1)} s)` : 'Calé automatiquement ✓';
    const c = st.calib;
    $('#top').classList.toggle('hidden', !!(!c || c.myTop || c.done));
    $('#cMsg').textContent = c ? c.msg || '' : '';
    const res = $('#cRes'); res.innerHTML = '';
    for (const it of (c && c.items) || []) {
      const d = document.createElement('div'); d.className = 'res';
      const n = document.createElement('span'); n.textContent = it.name;
      const v = document.createElement('span'); v.textContent = it.advance < 0.3 ? 'référence' : `${it.advance.toFixed(1)} s d'avance`;
      d.append(n, v); res.append(d);
    }
    $('#align').classList.toggle('hidden', !!(!(c && c.items && c.items.length >= 2) || c.done));
  }
}
function addLog(m) {
  const d = document.createElement('div');
  if (m.kind === 'sys') { d.className = 'sys'; d.textContent = m.text; }
  else {
    d.className = 'msg';
    const t = document.createElement('span'); t.className = 't'; t.textContent = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const b = document.createElement('b'); b.textContent = m.name === st?.me?.name ? 'Toi' : m.name;
    const x = document.createElement('span'); x.textContent = m.text; // jamais de HTML
    d.append(t, b, x);
  }
  $('#chat').append(d); $('#chat').scrollTop = $('#chat').scrollHeight;
}

// ---------- Photo de profil (réduite à 96 px, gardée dans le navigateur) ----------
function renderMyAvatar() {
  const el = avatarEl($('#name').value || '?', myAvatar); el.id = 'myAvatar'; $('#myAvatar').replaceWith(el);
  $('#photoBtn').textContent = myAvatar ? 'Changer ma photo' : 'Ajouter ma photo'; $('#photoDel').classList.toggle('hidden', !myAvatar);
}
$('#name').addEventListener('input', () => { if (!myAvatar) renderMyAvatar(); });
$('#photoBtn').onclick = () => $('#photoIn').click();
$('#photoDel').onclick = async () => { myAvatar = null; await chrome.storage.local.remove('avatar'); renderMyAvatar(); engine({ cmd: 'avatar', avatar: null }); };
$('#photoIn').onchange = async () => {
  const f = $('#photoIn').files[0]; if (!f) return;
  try {
    const bmp = await createImageBitmap(f); const S = 96, c = document.createElement('canvas'); c.width = c.height = S;
    const k = Math.min(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, (bmp.width - k) / 2, (bmp.height - k) / 2, k, k, 0, 0, S, S);
    myAvatar = c.toDataURL('image/jpeg', 0.8); await chrome.storage.local.set({ avatar: myAvatar }); renderMyAvatar();
    engine({ cmd: 'avatar', avatar: myAvatar });
  } catch { $('#err').textContent = 'Image illisible : essaie une photo JPG ou PNG.'; }
  $('#photoIn').value = '';
};

// ---------- Actions du salon ----------
$('#mute').onclick = () => { if (st && st.needMic) { openMicPage(); engine({ cmd: 'micGranted' }); } else engine({ cmd: 'mute' }); };
function sendChat() { const v = $('#chatIn').value.trim(); if (!v) return; engine({ cmd: 'chat', text: v }); $('#chatIn').value = ''; }
$('#send').onclick = sendChat;
$('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
$('#cStart').onclick = () => engine({ cmd: 'calibStart' });
$('#top').onclick = () => engine({ cmd: 'top' });
$('#align').onclick = () => engine({ cmd: 'align' });
$('#leave').onclick = () => engine({ cmd: 'leave' });
async function inviteLink(code) {
  let target = '';
  try { const tab = await chrome.tabs.get(tabId); target = tab.url || ''; } catch {}
  return `${server.replace(/\/$/, '')}/j/${code}` + (target ? `?u=${encodeURIComponent(target)}` : '');
}
async function copyInvite(code) {
  const link = await inviteLink(code);
  try { await navigator.clipboard.writeText(link); } catch { return false; }
  copiedAt = Date.now(); render(); setTimeout(render, 6100);
  return true;
}
$('#invite').onclick = async () => { if (!(await copyInvite(st.code))) addLog({ kind: 'sys', text: `Lien d'invitation : ${await inviteLink(st.code)}` }); };

// ---------- Plein écran : la fenêtre passe en plein écran, la vidéo occupe tout, le panneau se range ----------
$('#full').onclick = async () => {
  await chrome.runtime.sendMessage({ to: 'bg', cmd: 'immersive', tabId }).catch(() => {});
  if (!engineLocal) {
    try { await chrome.sidePanel?.close?.({ tabId }); } catch {}
    window.close(); // le panneau se range ; la voix continue (moteur à part)
  }
};

// ---------- Diagnostic du lecteur (lecture seule, rien n'est envoyé au serveur) ----------
$('#diag').onclick = async () => {
  const box = $('#diagOut'), btn = $('#diag');
  diagParts = []; btn.disabled = true; btn.textContent = 'Analyse… (3 s)';
  chrome.tabs.sendMessage(tabId, { t: 'diag' }).catch(() => {});
  await new Promise(r => setTimeout(r, 3500));
  let page = ''; try { const tab = await chrome.tabs.get(tabId); page = new URL(tab.url).hostname; } catch {}
  const report = { cowatch: chrome.runtime.getManifest().version, page, ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''),
    salon: st?.code || null, at: new Date().toISOString(), frames: diagParts };
  const txt = 'DIAGNOSTIC COWATCH\n' + JSON.stringify(report, null, 1);
  box.value = txt; box.classList.remove('hidden');
  let copied = false; try { await navigator.clipboard.writeText(txt); copied = true; } catch { box.select(); try { copied = document.execCommand('copy'); } catch {} }
  btn.disabled = false; btn.textContent = copied ? 'Copié ✓ — colle-le à Claude' : 'Sélectionne le texte et copie-le';
  setTimeout(() => { btn.textContent = 'Diagnostic'; }, 6000);
};
