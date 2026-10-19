// Panneau Cowatch : interface seulement. Le moteur (voix, connexions, synchro) tourne à part
// (document caché sur Chrome / Edge / Brave), ce qui permet de ranger le panneau sans couper la voix.
const DEFAULT_SERVER = 'https://salon-coche-private.onrender.com';
const EMOJIS = ['😂', '😱', '🔥', '💀', '👀', '😍', '⚽', '👏'];
const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);

let server = DEFAULT_SERVER, tabId = null, myAvatar = null, st = null, engineLocal = false, diagParts = [];

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
    if ($('#name').value.trim()) join(pendingJoin.code);
    else { $('#err').textContent = 'Choisis un pseudo puis clique sur Rejoindre.'; $('#name').focus(); }
  }
})();

function randomCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(5)), x => a[x % a.length]).join(''); }
// Accepte le lien d'invitation complet (…/j/CODE?u=…) ou le code seul.
function codeFrom(v) { v = (v || '').trim(); const m = v.match(/\/(?:j|s)\/([A-Za-z0-9-]{3,24})/); return (m ? m[1] : /^[A-Za-z0-9-]{3,24}$/.test(v) ? v : '').toUpperCase(); }
$('#create').onclick = () => join(randomCode());
$('#joinBtn').onclick = () => { const c = codeFrom($('#codeIn').value); if (c) join(c); else $('#err').textContent = 'Colle le lien d\'invitation reçu (ou le code du salon).'; };
$('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });
async function join(code) {
  const name = $('#name').value.trim();
  if (!name) { $('#err').textContent = 'Choisis un pseudo.'; $('#name').focus(); return; }
  await chrome.storage.local.set({ name }); $('#err').textContent = '';
  engine({ cmd: 'join', code, name, avatar: myAvatar, server, tabId });
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
  $('#err').textContent = st.err || '';
  $('#home').classList.toggle('hidden', st.inRoom); $('#room').classList.toggle('hidden', !st.inRoom);
  if (!st.inRoom) return;
  $('#code').textContent = st.code;
  const box = $('#peers'); box.innerHTML = '';
  for (const p of st.peers) {
    const el = document.createElement('div'); el.className = 'peer' + (p.self || p.state === 'connected' ? ' on' : '') + (p.speaking ? ' speaking' : '');
    el.dataset.id = p.id; el.dataset.state = p.self ? 'self' : p.state;
    const n = document.createElement('span'); n.textContent = p.self ? p.name + ' (toi)' : p.name;
    el.append(avatarEl(p.name, p.avatar), n); box.append(el);
  }
  $('#mute').textContent = st.muted ? 'Réactiver le micro' : 'Couper le micro';
  $('#micFix').classList.toggle('hidden', !st.needMic);
  // Direct : calage automatique ; le calage manuel (TOP) reste disponible pour ceux qui regardent sur la TV.
  const live = st.mode === 'live';
  $('#calib').classList.toggle('hidden', !live);
  if (live) {
    const a = st.autosync;
    $('#autoState').textContent = !a ? 'Calage automatique : en attente d\'un 2e lecteur…'
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
$('#mute').onclick = () => engine({ cmd: 'mute' });
$('#micFix').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') });
function sendChat() { const v = $('#chatIn').value.trim(); if (!v) return; engine({ cmd: 'chat', text: v }); $('#chatIn').value = ''; }
$('#send').onclick = sendChat;
$('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
$('#cStart').onclick = () => engine({ cmd: 'calibStart' });
$('#top').onclick = () => engine({ cmd: 'top' });
$('#align').onclick = () => engine({ cmd: 'align' });
$('#leave').onclick = () => engine({ cmd: 'leave' });
$('#invite').onclick = async () => {
  let target = '';
  try { const tab = await chrome.tabs.get(tabId); target = tab.url || ''; } catch {}
  const link = `${server.replace(/\/$/, '')}/j/${st.code}` + (target ? `?u=${encodeURIComponent(target)}` : '');
  try { await navigator.clipboard.writeText(link); $('#invite').textContent = 'Lien copié ✓'; setTimeout(() => $('#invite').textContent = "Copier l'invitation", 2000); }
  catch { addLog({ kind: 'sys', text: `Lien d'invitation : ${link}` }); }
};

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
