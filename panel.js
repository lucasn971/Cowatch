// Panneau Cowatch : interface seulement. Le moteur (voix, connexions, synchro) tourne à part
// (document caché sur Chrome / Edge / Brave), ce qui permet de ranger le panneau sans couper la voix.
// Mise en page commune à toutes les ambiances ; couleurs, polices, textes et émojis viennent de themes.js.
const DEFAULT_SERVER = 'https://salon-coche-private.onrender.com';
const T = self.CowatchThemes;
const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);

let server = DEFAULT_SERVER, tabId = null, myAvatar = null, st = null, engineLocal = false, diagParts = [];
let localErr = '', busy = null, busyTimer = null, copiedAt = 0; // busy : bouton qui attend la connexion (« create » ou « join »)
let pronoEditing = false, consent = null; // consent : accord pour les statistiques anonymes (null = pas encore demandé)
let theme = T.DEFAULT, picked = T.DEFAULT, choiceFor = 'create', calibOpen = false, lastLog = null, tabTitle = '', titleAt = 0;

// ---------- Ambiance : variables CSS, polices, textes, émojis ----------
function applyTheme(id) {
  if (!T.valid(id)) id = T.DEFAULT;
  const t = T.get(id), root = document.documentElement;
  for (const [k, v] of Object.entries(T.vars(id))) root.style.setProperty(k, v);
  root.dataset.theme = id; document.body.dataset.theme = id;
  // Vestiaire : polices fournies avec l'extension ; les autres ambiances : Google Fonts (graisses utiles seulement).
  $('#gfont').href = id === 'vestiaire' || !t.gfont ? '' : `https://fonts.googleapis.com/css2?${t.gfont}&display=swap`;
  if (theme !== id || !$('#react').childElementCount) {
    const box = $('#react'); box.innerHTML = '';
    t.emojis.forEach((em, i) => { const b = document.createElement('button'); b.textContent = em; b.setAttribute('aria-label', t.labels[i] || em); b.onclick = () => engine({ cmd: 'reaction', emoji: em }); box.append(b); });
  }
  theme = id;
  $('#invite').textContent = t.invite; $('#chatIn').placeholder = t.placeholder;
}

// ---------- Lien avec le moteur ----------
function ui(ev) {
  if (ev.ev === 'snap') { st = ev.state; render(); if (ev.log) { $('#chat').innerHTML = ''; lastLog = null; ev.log.forEach(addLog); } }
  if (ev.ev === 'log') addLog(ev.item);
  if (ev.ev === 'speak') { const el = document.querySelector(`.peer[data-id="${CSS.escape(ev.id)}"]`); if (el) { el.classList.toggle('speaking', ev.on); renderTag(el); } }
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
  const saved = await chrome.storage.local.get(['name', 'server', 'avatar', 'theme', 'consent']);
  consent = typeof saved.consent === 'boolean' ? saved.consent : null; renderConsent();
  if (saved.server) server = saved.server;
  if (params.get('server')) server = params.get('server');
  fetch(server.replace(/\/$/, '') + '/health').catch(() => {}); // réveille le serveur gratuit pendant qu'on tape son pseudo
  picked = T.valid(saved.theme) ? saved.theme : T.DEFAULT; applyTheme(picked);
  $('#name').value = saved.name || ''; myAvatar = saved.avatar || null; renderMyAvatar();
  tabId = params.get('tab') ? Number(params.get('tab')) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  buildCards();
  chrome.runtime.onMessage.addListener((m, sender) => {
    if (m.to === 'ui') ui(m);
    if (sender.tab && sender.tab.id === tabId && m.cmd === 'diag') diagParts.push(m.data);
    // Une vidéo vient d'apparaître dans l'onglet affiché (page encore en chargement quand on y est allé) : le salon la prend.
    // Aussi quand l'onglet suivi n'a pas de vidéo (panneau ouvert sur « Extensions », par exemple) : la vidéo d'un autre onglet de la fenêtre est prise.
    if (m.cmd === 'video' && m.found && sender.tab && sender.tab.id !== tabId && followOn && (myWin == null || sender.tab.windowId === myWin) && (sender.tab.active || !(st && st.video))) considerTab(sender.tab.id);
  });
  if (tabId != null) watchPanelFor(tabId);
  // Rappel régulier à la page vidéo que le panneau est ouvert (l'arrière-plan de Chrome peut s'endormir et oublier) : pas de languette en double.
  setInterval(() => { if (tabId != null && document.visibilityState === 'visible') chrome.tabs.sendMessage(tabId, { t: 'panel', open: true }).catch(() => {}); }, 4000);
  await startEngine();
  await engine({ cmd: 'hello', tabId });
  chrome.tabs.sendMessage(tabId, { t: 'ping-video' }).catch(() => {});
  const { pendingJoin } = await chrome.storage.local.get('pendingJoin');
  onInvite(pendingJoin);
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.pendingJoin?.newValue) onInvite(ch.pendingJoin.newValue); });
  followTabs();
})();

// Invitation cliquée (page /j/CODE) : on rejoint tout de suite ; si on est déjà dans un autre salon, on propose d'y aller.
async function onInvite(p) {
  if (!p || Date.now() - p.at > 30 * 60 * 1000) return;
  await chrome.storage.local.remove('pendingJoin');
  if (st && st.inRoom) {
    if (st.code === p.code) return;
    $('#invCode').textContent = p.code; $('#invBar').classList.remove('hidden'); return;
  }
  $('#codeIn').value = p.code;
  if ($('#name').value.trim()) join(p.code, 'join');
  else { setInvite(p.code); showErr('Choisis ton pseudo pour rejoindre.', '#name'); }
}
$('#invGo').onclick = () => { const c = $('#invCode').textContent; $('#invBar').classList.add('hidden'); if (c) join(c, 'join'); };

// Le panneau latéral de Chrome est commun à tous les onglets : il suit l'onglet affiché.
// Hors salon, il suit toujours l'onglet actif ; en salon, il ne bascule que vers un onglet qui a une vidéo.
let myWin = null, followOn = false, considerTab = () => {};
async function followTabs() {
  if ((params.get('tab') && !params.get('follow')) || !chrome.tabs?.onActivated) return; // fenêtre séparée (Firefox, tests) : onglet fixé
  try { myWin = (await chrome.windows.getCurrent()).id; } catch {}
  followOn = true;
  const consider = considerTab = async id => {
    if (id == null || id === tabId) return;
    if (st && st.inRoom) { const has = await chrome.tabs.sendMessage(id, { t: 'has-video' }).catch(() => null); if (!has) return; }
    tabId = id; titleAt = 0; watchPanelFor(id);
    engine({ cmd: 'bindTab', tabId: id }); engine({ cmd: 'hello', tabId: id });
    chrome.tabs.sendMessage(id, { t: 'ping-video' }).catch(() => {}); render();
  };
  chrome.tabs.onActivated.addListener(i => { if (myWin == null || i.windowId === myWin) consider(i.tabId); });
  // En salon sans vidéo sur l'onglet suivi : on cherche toutes les 3 s une vidéo dans les autres onglets de la fenêtre.
  setInterval(async () => {
    if (!(st && st.inRoom) || st.video) return;
    const tabs = await chrome.tabs.query(myWin == null ? { currentWindow: true } : { windowId: myWin }).catch(() => []);
    tabs.sort((a, b) => (b.active - a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
    for (const t of tabs) { if (t.id === tabId || !/^https?:/.test(t.url || '')) continue; if (await chrome.tabs.sendMessage(t.id, { t: 'has-video' }).catch(() => null)) { consider(t.id); return; } }
  }, 3000);
  chrome.tabs.onUpdated.addListener((id, ch, tab) => { if (ch.status === 'complete' && tab.active && (myWin == null || tab.windowId === myWin)) { if (id === tabId) { titleAt = 0; render(); } else consider(id); } });
}

// Signale à la page que le panneau est ouvert (sa languette « Cowatch » se calme) ; reconnexion si l'arrière-plan redémarre.
let panelPort = null;
function watchPanelFor(id) {
  try { if (panelPort) { const old = panelPort; panelPort = null; old.disconnect(); } } catch {}
  const open = () => { try { const p = chrome.runtime.connect({ name: 'panel:' + id }); panelPort = p; p.onDisconnect.addListener(() => { if (panelPort === p) setTimeout(() => { if (panelPort === p) open(); }, 500); }); } catch {} };
  open();
}
function randomCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(5)), x => a[x % a.length]).join(''); }
// Accepte le lien d'invitation complet (…/j/CODE?u=…) ou le code seul.
function codeFrom(v) { v = (v || '').trim(); const m = v.match(/\/(?:j|s)\/([A-Za-z0-9-]{3,24})/); return (m ? m[1] : /^[A-Za-z0-9-]{3,24}$/.test(v) ? v : '').toUpperCase(); }
function showErr(msg, field) {
  localErr = msg; $('#err').textContent = msg;
  if (field) { $(field).classList.add('bad'); $(field).focus(); }
}
$('#name').addEventListener('input', () => { $('#name').classList.remove('bad'); if (localErr) showErr(''); if (!myAvatar) renderMyAvatar(); });
$('#codeIn').addEventListener('input', () => { $('#codeIn').classList.remove('bad'); if (localErr) showErr(''); });
// Créer : d'abord « Ce soir, quelle ambiance ? », puis « C'est parti » crée le salon.
$('#create').onclick = () => {
  if (busy) return;
  if (!$('#name').value.trim()) return showErr('Choisis un pseudo.', '#name');
  if (inviteCode) return join(inviteCode, 'join'); // arrivé par une invitation : le gros bouton rejoint ce salon
  openChoice('create');
};
// Arrivée par une invitation sans pseudo : le bouton principal devient « Rejoindre le salon X » (essai réel du 23/10 :
// « Créer un salon » restait en avant et Lucas a créé un salon à côté). Vider le champ du code rend « Créer un salon ».
let inviteCode = '';
function setInvite(code) {
  inviteCode = code || '';
  $('#create').textContent = inviteCode ? `Rejoindre le salon ${inviteCode}` : 'Créer un salon';
}
$('#codeIn').addEventListener('input', () => { if (inviteCode && codeFrom($('#codeIn').value) !== inviteCode) setInvite(''); });
$('#joinBtn').onclick = () => {
  const v = $('#codeIn').value, c = codeFrom(v);
  if (!c) return showErr('Colle le lien d\'invitation reçu.', '#codeIn');
  if (join(c, 'join') !== false) openTarget(targetFrom(v)); // lien collé : on ouvre aussi la page que regarde celui qui invite
};
// Page de la plateforme jointe au lien d'invitation (…/j/CODE?u=…) : seulement les sites où Cowatch fonctionne.
const SITES = ['netflix.com', 'primevideo.com', 'amazon.fr', 'amazon.com', 'disneyplus.com', 'canalplus.com', 'tf1.fr', 'paramountplus.com', 'youtube.com'];
function targetFrom(v) {
  try {
    const u = new URL(new URL(String(v || '').trim()).searchParams.get('u') || '');
    if (u.protocol === 'https:' && SITES.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) return u.toString();
  } catch {}
  return '';
}
async function openTarget(url) {
  if (!url) return;
  try {
    const cur = tabId != null ? await chrome.tabs.get(tabId) : null, a = new URL(url), b = cur && cur.url ? new URL(cur.url) : null;
    if (b && b.hostname === a.hostname && b.pathname === a.pathname) return; // déjà sur la bonne page
    await chrome.tabs.create({ url, active: true }); // le salon suivra cet onglet dès que la vidéo y apparaît
  } catch {}
}
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
    await engine({ cmd: 'join', from, code, name, avatar: myAvatar, server, tabId, consent: consent === true, version: chrome.runtime.getManifest().version, theme: from === 'create' ? picked : undefined });
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
  if (busy && st && !st.joining && !st.inRoom && st.err) busy = null; // échec : on rend la main
  if (st && st.inRoom) { busy = null; clearTimeout(busyTimer); }
  const wait = st && st.wake ? 'Réveil du serveur… (≈ 30 s)' : 'Connexion…';
  $('#go').disabled = busy === 'create'; $('#go').textContent = busy === 'create' ? wait : (choiceFor === 'change' ? 'Changer d\'ambiance' : 'C\'est parti');
  $('#create').disabled = !!busy; $('#joinBtn').disabled = !!busy;
  $('#joinBtn').textContent = busy === 'join' ? wait : 'Rejoindre';
}

// ---------- Ce soir, quelle ambiance ? ----------
function buildCards() {
  const box = $('#cards'); box.innerHTML = '';
  for (const id of T.ORDER) {
    const t = T.THEMES[id], b = document.createElement('button');
    b.className = 'card'; b.dataset.id = id; b.setAttribute('role', 'radio');
    if (t.soon) b.setAttribute('aria-disabled', 'true');
    const art = document.createElement('div'); art.className = 'art'; art.style.background = t.cardBg;
    for (const [k, v] of Object.entries(T.vars(t.soon ? 'vestiaire' : id))) art.style.setProperty(k, v);
    // Aperçu compact : les couleurs et trois émojis de l'ambiance (pas de texte qui déborde).
    const em = document.createElement('span'); em.className = 'cw-emo'; em.textContent = t.soon ? '' : t.emojis.slice(0, 3).join(' ');
    const bar = document.createElement('i'); bar.className = 'cw-acc'; bar.style.background = t.soon ? '#2A2A30' : t.accent;
    art.append(em, bar);
    const n = document.createElement('b'); n.textContent = t.soon ? `${t.name} · bientôt` : t.name;
    const d = document.createElement('span'); d.className = 'd'; d.textContent = t.desc;
    b.append(art, n, d);
    b.onclick = () => { if (t.soon) return; picked = id; renderCards(); };
    box.append(b);
  }
  renderCards();
}
function renderCards() {
  document.querySelectorAll('.card').forEach(c => c.setAttribute('aria-checked', String(c.dataset.id === picked)));
  $('#pickedName').textContent = T.get(picked).name;
}
function openChoice(forWhat) {
  choiceFor = forWhat; picked = forWhat === 'change' ? theme : picked; renderCards();
  $('#home').classList.add('hidden'); $('#room').classList.add('hidden'); $('#choice').classList.remove('hidden');
  renderBusy();
}
function closeChoice() { $('#choice').classList.add('hidden'); render(); if (!st || !st.inRoom) $('#home').classList.remove('hidden'); }
$('#choiceBack').onclick = closeChoice;
$('#go').onclick = () => {
  chrome.storage.local.set({ theme: picked });
  if (choiceFor === 'change') { engine({ cmd: 'theme', theme: picked }); closeChoice(); return; }
  if (busy) return;
  applyTheme(picked);
  const code = randomCode();
  join(code, 'create', copyInvite(code)); // le lien est copié tout de suite : il n'y a plus qu'à le coller à ses amis
};

// ---------- Menu « … » ----------
$('#menuBtn').onclick = e => { e.stopPropagation(); const open = $('#menu').classList.toggle('hidden') === false; $('#menuBtn').setAttribute('aria-expanded', String(open)); };
document.addEventListener('click', e => { if (!$('#menu').contains(e.target)) { $('#menu').classList.add('hidden'); $('#menuBtn').setAttribute('aria-expanded', 'false'); } });
// Replier : le panneau se range, la vidéo prend toute la largeur (écran « plein écran » des maquettes) ; la languette le rouvre.
$('#foldBtn').onclick = async () => {
  if (engineLocal) return; // Firefox / Opera : le moteur vit dans le panneau, le fermer couperait la voix
  try { await chrome.sidePanel?.close?.({ tabId }); } catch {}
  window.close();
};
$('#menu').addEventListener('click', e => { if (e.target.closest('button')) { $('#menu').classList.add('hidden'); $('#menuBtn').setAttribute('aria-expanded', 'false'); } }); // un choix referme le menu
$('#mTheme').onclick = () => openChoice('change');
$('#mCalib').onclick = () => { calibOpen = !calibOpen; if (calibOpen) $('#manual').open = true; render(); };

// ---------- Affichage ----------
function colorOf(name) { let h = 0; for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 45% 40%)`; }
function avatarEl(name, src) {
  if (src) { const i = document.createElement('img'); i.className = 'avatar'; i.src = src; i.alt = ''; return i; }
  const s = document.createElement('span'); s.className = 'avatar'; s.textContent = (name || '?').trim().charAt(0).toUpperCase(); s.style.background = colorOf(name); return s;
}
function renderTag(el) { const tag = el.querySelector('.tag'); if (tag) tag.textContent = el.classList.contains('speaking') ? 'parle' : el.classList.contains('unstable') ? 'connexion instable' : el.dataset.self === '1' ? 'toi' : ''; }
async function refreshTitle() {
  if (Date.now() - titleAt < 5000) return; titleAt = Date.now();
  try { const tab = await chrome.tabs.get(tabId); tabTitle = (tab.title || '').replace(/\s*[|–-]\s*(Netflix|Prime Video|TF1\+?|Canal\+|myCANAL|YouTube|Paramount\+|Disney\+|M6\+?|france\.tv).*$/i, '').trim(); } catch {}
  $('#nowTitle').textContent = tabTitle || 'Le programme';
}
function render() {
  if (!st) return;
  $('#unstableHelp').classList.toggle('hidden', !(st.inRoom && st.unstable)); // coupures répétées chez soi
  // Diagnostic automatique : un souci a été noté => un bouton pour copier le rapport (rien n'est envoyé tout seul).
  $('#issueBar').classList.toggle('hidden', !(st.inRoom && st.issue));
  $('#playerStatus').textContent = st.video ? 'Vidéo détectée ✓' : 'Aucune vidéo détectée'; $('#playerStatus').classList.toggle('ok', !!st.video);
  $('#err').textContent = localErr || st.err || '';
  renderBusy();
  const inChoice = !$('#choice').classList.contains('hidden');
  if (st.inRoom && T.valid(st.theme) && st.theme !== theme) applyTheme(st.theme);
  if (!inChoice) { $('#home').classList.toggle('hidden', st.inRoom); $('#room').classList.toggle('hidden', !st.inRoom); }
  else if (st.inRoom && choiceFor === 'create') { $('#choice').classList.add('hidden'); $('#room').classList.remove('hidden'); }
  for (const id of ['#mTheme', '#mCalib', '#leave', '#mRecap']) $(id).classList.toggle('hidden', !st.inRoom);
  if (st.inRoom && !st.owner) $('#mRecap').classList.add('hidden'); // le créateur du salon siffle la fin
  $('#foldBtn').classList.toggle('hidden', !st.inRoom || engineLocal);
  $('.menu-code').classList.toggle('hidden', !st.inRoom);
  if (st.inRoom && !st.owner) $('#mTheme').classList.add('hidden'); // seul celui qui a créé le salon change l'ambiance
  if (!st.inRoom) { $('#recap').classList.add('hidden'); $('#recapEdit').classList.add('hidden'); return; }
  renderRecap();
  if (inviteCode) setInvite('');
  $('#code').textContent = st.code;
  refreshTitle();
  const t = T.get(theme);
  $('#invite').textContent = Date.now() - copiedAt < 6000 ? 'Lien copié ✓' : t.invite;
  // Le groupe
  const others = st.peers.filter(p => !p.self);
  $('#groupTitle').textContent = `${t.groupWord} · ${st.peers.length}`;
  const box = $('#peers'); box.innerHTML = '';
  for (const p of st.peers) {
    const el = document.createElement('div'); el.className = 'peer' + (p.self || p.state === 'connected' ? ' on' : ' off') + (p.speaking ? ' speaking' : '');
    el.dataset.id = p.id; el.dataset.state = p.self ? 'self' : p.state; el.dataset.self = p.self ? '1' : '';
    const av = document.createElement('span'); av.className = 'av'; av.append(avatarEl(p.name, p.avatar));
    if (p.muted) { const mb = document.createElement('span'); mb.className = 'mutedBadge'; mb.textContent = '🔇'; mb.title = 'Micro coupé'; av.append(mb); }
    const n = document.createElement('span'); n.className = 'who'; n.textContent = p.name;
    const tag = document.createElement('span'); tag.className = 'tag';
    if (p.unstable) el.classList.add('unstable');
    el.append(av, n, tag); renderTag(el);
    if (p.unstable) { tag.title = 'Coupures répétées : Wi-Fi faible ou ordinateur en économie d\'énergie'; }
    box.append(el);
  }

  // Calés ?
  const live = st.mode === 'live', a = st.autosync, syncEl = $('#synced');
  const ok = others.length > 0 && (!live || (a && !st.noAutoClock));
  syncEl.classList.toggle('wait', !ok);
  $('#syncedTxt').textContent = !others.length ? 'seul pour l\'instant' : live && st.noAutoClock ? 'calage manuel' : ok ? 'calés' : 'calage…';
  // Micro : une seule icône. Activer (pas encore autorisé) / couper / réactiver.
  const mute = $('#mute'), label = st.needMic ? 'Activer mon micro' : st.muted ? 'Réactiver le micro' : 'Couper le micro';
  mute.setAttribute('aria-label', label); mute.title = label; $('#muteTxt').textContent = label;
  mute.classList.toggle('need', !!st.needMic); mute.classList.toggle('muted', !!st.muted && !st.needMic);
  $('#micHelp').classList.toggle('hidden', !st.needMic || !st.micErr);
  $('#micHelp').textContent = st.micErr === 'NotFoundError' ? 'Aucun micro trouvé sur cet ordinateur. Branche un casque ou des écouteurs avec micro.'
    : st.micErr === 'NotReadableError' ? 'Le micro est déjà utilisé par une autre application (Zoom, Teams, FaceTime…). Ferme-la puis clique sur le micro.'
    : 'Micro bloqué. Clique sur le micro et réponds « Autoriser ». Sur Mac, vérifie aussi Réglages Système › Confidentialité › Micro › Chrome.';
  $('#net').textContent = st.joining ? 'Reconnexion…' : '';
  // Vestiaire : prono d'avant-match et bouton VAR
  const vest = theme === 'vestiaire';
  $('#prono').classList.toggle('hidden', !vest);
  if (vest) {
    // Une fois le prono donné, le bloc se replie en une ligne ; les pronos de tout le monde sont sur la vidéo (volet à gauche).
    const mine = (st.pronos || []).find(x => x.name === st.me?.name);
    const editing = !mine || pronoEditing;
    if (mine && document.activeElement !== $('#pH') && document.activeElement !== $('#pA')) { const [h, w] = mine.score.split('-'); $('#pH').value = h; $('#pA').value = w; }
    $('#pronoEdit').classList.toggle('hidden', !editing); $('#pronoDone').classList.toggle('hidden', editing);
    if (mine) $('#pronoMine').textContent = mine.score;
    const others = (st.pronos || []).filter(x => x.name !== st.me?.name).length;
    $('#pronoList').textContent = editing && !mine ? 'Chacun donne son score avant le coup d\'envoi.' : '';
    $('#pronoList').classList.toggle('hidden', !(editing && !mine));
    $('#pronoDone').title = others ? `${others} autre${others > 1 ? 's' : ''} prono${others > 1 ? 's' : ''} : voir le volet « Prono du groupe » sur la vidéo` : '';
  }
  $('#goalBar').classList.toggle('hidden', !(vest && st.myGoal));
  // Direct : calage automatique ; calage manuel (TOP) via le menu, ou tout de suite si le site ne permet pas le calage auto.
  $('#calib').classList.toggle('hidden', !(live && (calibOpen || st.noAutoClock)));
  if (live) {
    $('#autoState').textContent = st.noAutoClock ? 'Calage automatique indisponible sur ce site : utilisez le TOP.'
      : !a ? 'Calage automatique : en attente d\'un 2e lecteur…'
      : a.spread > 0.6 ? `Calé automatiquement ✓ (écart corrigé : ${a.spread.toFixed(1)} s)` : 'Calé automatiquement ✓';
    if (st.noAutoClock) $('#manual').open = true;
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
// Chat : prénom une fois par série de messages, heure au survol ; messages système en petites pastilles centrées.
function addLog(m) {
  const d = document.createElement('div');
  if (m.kind === 'sys') { d.className = 'sys'; d.textContent = m.text; lastLog = null; }
  else {
    const mine = m.name === st?.me?.name, same = lastLog && lastLog.name === m.name && m.at - lastLog.at < 3 * 60 * 1000;
    d.className = 'msg' + (same ? '' : ' first') + (mine ? ' mine' : '');
    d.title = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (!same) { const b = document.createElement('b'); b.textContent = mine ? 'Toi' : m.name; d.append(b); }
    const x = document.createElement('span'); x.textContent = m.text; // jamais de HTML
    d.append(x); lastLog = { name: m.name, at: m.at };
  }
  $('#chat').append(d); $('#chat').scrollTop = $('#chat').scrollHeight;
}

// ---------- Photo de profil (réduite à 96 px, gardée dans le navigateur) ----------
function renderMyAvatar() {
  const el = avatarEl($('#name').value || '?', myAvatar); el.id = 'myAvatar'; $('#myAvatar').replaceWith(el);
  $('#photoBtn').textContent = myAvatar ? 'Changer ma photo' : 'Ajouter ma photo'; $('#photoDel').classList.toggle('hidden', !myAvatar);
}
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
$('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
$('#pGo').onclick = () => {
  const h = parseInt($('#pH').value, 10), a = parseInt($('#pA').value, 10);
  if (!(h >= 0 && h <= 20 && a >= 0 && a <= 20)) { $('#pH').classList.add('bad'); return; }
  $('#pH').classList.remove('bad'); pronoEditing = false; engine({ cmd: 'prono', score: `${h}-${a}` });
};
$('#pronoDone').onclick = () => { pronoEditing = true; render(); $('#pH').focus(); };
for (const id of ['#pH', '#pA']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('#pGo').click(); });
$('#goalCancel').onclick = () => engine({ cmd: 'goalCancel' });
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

// ---------- Diagnostic du lecteur (lecture seule, rien n'est envoyé au serveur) ----------
$('#diag').onclick = async () => {
  const box = $('#diagOut'), btn = $('#diag');
  diagParts = []; btn.disabled = true; btn.textContent = 'Analyse… (3 s)';
  chrome.tabs.sendMessage(tabId, { t: 'diag' }).catch(() => {});
  await new Promise(r => setTimeout(r, 3500));
  let page = ''; try { const tab = await chrome.tabs.get(tabId); page = new URL(tab.url).hostname; } catch {}
  const auto = await engine({ cmd: 'report' }) || {};
  const report = { cowatch: chrome.runtime.getManifest().version, ...auto, page, ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''), frames: diagParts };
  engine({ cmd: 'issueSeen' }); $('#issueBar').classList.add('hidden');
  const txt = 'DIAGNOSTIC COWATCH\n' + JSON.stringify(report, null, 1);
  box.value = txt; box.classList.remove('hidden');
  let copied = false; try { await navigator.clipboard.writeText(txt); copied = true; } catch { box.select(); try { copied = document.execCommand('copy'); } catch {} }
  btn.disabled = false; btn.textContent = copied ? 'Copié ✓ — colle-le à Claude' : 'Sélectionne le texte et copie-le';
  // Aucune réponse de la page : Cowatch n'y tourne pas (onglet ouvert avant l'installation ou la mise à jour).
  if (!diagParts.length) { const t = 'Cowatch ne voit pas la vidéo : recharge la page du programme.'; $('#err').textContent = t; $('#net').textContent = t; }
  setTimeout(() => { btn.textContent = 'Copier le rapport (souci)'; if (copied) box.classList.add('hidden'); }, 6000);
};

$('#issueGo').onclick = () => $('#diag').click();

// ---------- Récap de fin de match ----------
// Le créateur du salon ouvre « Fin du match · récap » ; en Vestiaire il donne le score final pour juger les pronos.
const fmtPos = (kind, pos) => {
  if (kind === 'real') return new Date(pos * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const h = Math.floor(pos / 3600), m = Math.floor(pos % 3600 / 60), sec = Math.floor(pos % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const fmtDur = min => min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
$('#mRecap').onclick = () => {
  const vest = theme === 'vestiaire';
  $('#recapScore').classList.toggle('hidden', !vest); $('#recapAsk').textContent = vest ? 'Score final' : 'Fin de la séance';
  $('#rGo').textContent = vest ? 'Récap' : 'Voir le récap';
  $('#recapEdit').classList.remove('hidden'); if (vest) $('#rH').focus();
};
$('#rCancel').onclick = () => $('#recapEdit').classList.add('hidden');
$('#rGo').onclick = () => {
  let score = '';
  if (theme === 'vestiaire') {
    const h = $('#rH').value, a = $('#rA').value;
    if (h === '' || a === '') { $(h === '' ? '#rH' : '#rA').focus(); return; }
    score = `${Math.min(20, Math.max(0, parseInt(h, 10) || 0))}-${Math.min(20, Math.max(0, parseInt(a, 10) || 0))}`;
  }
  engine({ cmd: 'recap', score }); $('#recapEdit').classList.add('hidden');
};
for (const id of ['#rH', '#rA']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('#rGo').click(); });
let recapShown = null;
function renderRecap() {
  const r = st.recap, box = $('#recap');
  if (!r) { box.classList.add('hidden'); recapShown = null; return; }
  box.classList.remove('hidden');
  if (recapShown === r.at) return; recapShown = r.at;
  const vest = theme === 'vestiaire', esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const badge = { exact: '🎯 dans le mille', bon: '✓ bon vainqueur', rate: '✗' };
  let h = `<div class="rc-head"><span class="kicker">${vest ? 'Récap du match' : 'Récap de la séance'}</span>${r.score ? `<span class="rc-score">${esc(r.score)}</span>` : ''}</div>`;
  if (r.pronos.length) {
    h += `<div class="kicker rc-sub">Pronos</div>`;
    for (const p of r.pronos) h += `<div class="rc-line"><span>${esc(p.name)} <b>${esc(p.score)}</b></span><span class="muted">${p.res ? badge[p.res] : ''}</span></div>`;
  }
  if (r.buts.length) h += `<div class="rc-line"><span>${r.buts.length} BUUUT${r.buts.length > 1 ? 'S' : ''}</span><span class="muted">${r.buts.map(b => b.pos != null ? fmtPos(b.kind, b.pos) : '').filter(Boolean).join(' · ')}</span></div>`;
  if (r.moments.length) {
    h += `<div class="kicker rc-sub">Meilleurs moments</div>`;
    for (const m of r.moments) h += `<div class="rc-line"><span>${fmtPos(m.kind, m.pos)}</span><span>${esc(m.emoji)} · ${m.n} réactions</span></div>`;
  }
  h += `<div class="small muted rc-sub">${r.reactions} réaction${r.reactions > 1 ? 's' : ''} · ${r.messages} message${r.messages > 1 ? 's' : ''} · ${fmtDur(r.duree)} ensemble</div>`;
  h += `<button id="rClose" class="link small rc-close">Fermer</button>`;
  box.innerHTML = h;
  $('#rClose').onclick = () => engine({ cmd: 'recapClose' });
}

// ---------- Statistiques anonymes (phase de test) : accord demandé une fois, modifiable dans le menu ----------
function renderConsent() {
  $('#consentBox').classList.toggle('hidden', consent !== null);
  $('#mConsent').textContent = `Statistiques anonymes : ${consent ? 'oui' : 'non'}`;
}
async function setConsent(v) { consent = v; await chrome.storage.local.set({ consent: v }); renderConsent(); engine({ cmd: 'consent', consent: v }); }
$('#consentYes').onclick = () => setConsent(true);
$('#consentNo').onclick = () => setConsent(false);
$('#mConsent').onclick = () => setConsent(!consent);
