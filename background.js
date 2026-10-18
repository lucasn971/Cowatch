// Clic sur l'icône = ouverture du panneau latéral Salon à côté de la vidéo.
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Lien d'invitation : on mémorise le salon à rejoindre, le panneau le reprendra à son ouverture.
  if (msg.cmd === 'pendingJoin') {
    chrome.storage.session.set({ pendingJoin: { code: msg.code, at: Date.now() } }).then(() => reply({ ok: true }));
    return true;
  }
  // Ouverture du panneau depuis un clic dans la page (bulle "Rejoindre le salon").
  if (msg.cmd === 'openPanel' && sender.tab) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => reply({ ok: true })).catch(e => reply({ ok: false, error: String(e) }));
    return true;
  }
});
