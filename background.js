// Cowatch — script d'arrière-plan commun à Chrome, Edge, Brave, Opera et Firefox (ordinateur et Android).
// Où s'ouvre le panneau selon le navigateur :
//  - Chrome, Edge, Brave : panneau latéral natif (API sidePanel), à côté de la vidéo ;
//  - Firefox ordinateur : barre latérale (sidebarAction) ;
//  - Opera et navigateurs sans panneau : petite fenêtre à part ;
//  - Firefox Android : nouvel onglet (pas de fenêtre ni de barre latérale sur mobile).
const B = globalThis.browser;
const hasSidePanel = !!(chrome.sidePanel && chrome.sidePanel.setPanelBehavior);
const hasSidebar = !!(B && B.sidebarAction && B.sidebarAction.open);

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
});

// Raccourci clavier (Alt+Maj+M) : couper / réactiver le micro, même vidéo en plein écran.
chrome.commands?.onCommand.addListener(cmd => { if (cmd === 'toggle-mic') chrome.runtime.sendMessage({ cmd: 'toggleMic' }).catch(() => {}); });
