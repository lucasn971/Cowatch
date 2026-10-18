const $ = s => document.querySelector(s);
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const saved = await chrome.storage.local.get(['server', 'room', 'name']);
  $('#server').value = saved.server || 'http://localhost:8080';
  $('#room').value = saved.room || '';
  $('#name').value = saved.name || '';
  const show = s => $('#st').textContent = s;
  const st = await chrome.runtime.sendMessage({ cmd: 'status', tabId: tab.id });
  show(st?.connected ? `Connecté au salon ${st.room}${st.isHost ? ' (pilote)' : ''}` : 'Non connecté');
  $('#join').onclick = async () => {
    const server = $('#server').value.trim(), room = $('#room').value.trim().toUpperCase(), name = $('#name').value.trim() || 'Invité';
    if (!room) return show('Entre le code du salon.');
    await chrome.storage.local.set({ server, room, name });
    const r = await chrome.runtime.sendMessage({ cmd: 'join', tabId: tab.id, server, room, name });
    show(r?.ok ? `Connecté au salon ${room}` : `Erreur : ${r?.error || 'inconnue'}`);
  };
  $('#leave').onclick = async () => { await chrome.runtime.sendMessage({ cmd: 'leave', tabId: tab.id }); show('Déconnecté'); };
})();
