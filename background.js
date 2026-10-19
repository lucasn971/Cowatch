// Cowatch — script d'arrière-plan commun à Chrome, Edge, Brave, Opera et Firefox (ordinateur et Android).
// Où s'ouvre le panneau selon le navigateur :
//  - Chrome, Edge, Brave : panneau latéral natif (API sidePanel), à côté de la vidéo ;
//  - Firefox ordinateur : barre latérale (sidebarAction) ;
//  - Opera et navigateurs sans panneau : petite fenêtre à part ;
//  - Firefox Android : nouvel onglet (pas de fenêtre ni de barre latérale sur mobile).
// Le « moteur » (voix, connexions) tourne dans un document caché (offscreen) quand le navigateur le permet :
// on peut alors fermer le panneau (plein écran) sans couper la voix.
const B = globalThis.browser;
const hasSidePanel = !!(chrome.sidePanel && chrome.sidePanel.setPanelBehavior);
const hasSidebar = !!(B && B.sidebarAction && B.sidebarAction.open);
const hasOffscreen = !!(chrome.offscreen && chrome.offscreen.createDocument);

if (hasSidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}));
} else {
  chrome.action.onClicked.addListener(tab => { openPanelFor(tab).catch(() => {}); });
}

async function openPanelFor(tab) {
  if (hasSidePanel) { await chrome.sidePanel.open({ tabId: tab.id }); return 'sidepanel'; }
  if (hasSidebar) { try { await B.sidebarAction.open(); return 'sidebar'; } catch (e) { /* hors geste utilisateur : on passe à la fenêtre */ } }
  const url = chrome.runtime.getURL(`panel.html?tab=${tab.id}`);
  if (chrome.windows && chrome.windows.create) {
    try { await chrome.windows.create({ url, type: 'popup', width: 400, height: 760 }); return 'window'; } catch (e) {}
  }
  await chrome.tabs.create({ url, active: true }); // Firefox Android
  return 'tab';
}

let creating = null;
async function ensureEngine() {
  if (!hasOffscreen) return false;
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (ctx.length) return true;
  }
  creating = creating || chrome.offscreen.createDocument({ url: 'engine.html', reasons: ['USER_MEDIA', 'WEB_RTC'], justification: 'Salon vocal Cowatch : la voix continue quand le panneau est fermé (plein écran).' })
    .catch(e => { if (!String(e).includes('single offscreen')) throw e; }).finally(() => { creating = null; });
  await creating; return true;
}

// Plein écran Cowatch : la fenêtre passe en plein écran, le lecteur occupe tout l'écran, le panneau se range.
async function immersive(tabId, on) {
  const tab = await chrome.tabs.get(tabId);
  if (on) {
    const win = await chrome.windows.get(tab.windowId);
    await chrome.storage.session?.set({ ['win' + tab.windowId]: win.state }).catch(() => {});
    if (win.state !== 'fullscreen') await chrome.windows.update(tab.windowId, { state: 'fullscreen' }).catch(() => {});
    await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  } else {
    const k = 'win' + tab.windowId; const st = (await chrome.storage.session?.get(k).catch(() => ({})))?.[k];
    await chrome.windows.update(tab.windowId, { state: st && st !== 'fullscreen' ? st : 'normal' }).catch(() => {});
  }
  await chrome.tabs.sendMessage(tabId, { t: 'immersive', on }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Lien d'invitation : on mémorise le salon à rejoindre (30 min), le panneau le reprendra à son ouverture.
  if (msg.cmd === 'pendingJoin') {
    chrome.storage.local.set({ pendingJoin: { code: msg.code, at: Date.now() } }).then(() => reply({ ok: true }));
    return true;
  }
  // Ouverture du panneau depuis la bulle « Rejoindre le salon » affichée sur la vidéo.
  if (msg.cmd === 'openPanel' && sender.tab) {
    openPanelFor(sender.tab).then(where => reply({ ok: true, where })).catch(e => reply({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.to !== 'bg') return;
  if (msg.cmd === 'ensureEngine') { ensureEngine().then(ok => reply({ ok })).catch(e => reply({ ok: false, error: String(e) })); return true; }
  if (msg.cmd === 'relay') { chrome.tabs.sendMessage(msg.tabId, msg.m).catch(() => {}); return; }
  if (msg.cmd === 'engineIdle') { chrome.offscreen?.closeDocument?.().catch(() => {}); return; }
  if (msg.cmd === 'immersive') { immersive(msg.tabId, true).then(() => reply({ ok: true })).catch(e => reply({ ok: false, error: String(e) })); return true; }
  if (msg.cmd === 'exitImmersive' && sender.tab) {
    // Clic ou touche Échap dans la page : geste utilisateur => on peut rouvrir le panneau.
    if (hasSidePanel) chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    immersive(sender.tab.id, false).then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
});

// Raccourci clavier (Alt+Maj+M) : couper / réactiver le micro, même en plein écran.
chrome.commands?.onCommand.addListener(cmd => { if (cmd === 'toggle-mic') chrome.runtime.sendMessage({ to: 'engine', cmd: 'mute', toast: true }).catch(() => {}); });
