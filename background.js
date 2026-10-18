// Une connexion WebSocket par onglet synchronisé. Le service worker relaie entre le serveur et le content script.
const sessions = new Map(); // tabId -> {ws, room, name, id, host, offset}

function wsUrl(server) { const u = new URL(server); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; u.pathname = '/'; return u.toString(); }
function toTab(tabId, msg) { chrome.tabs.sendMessage(tabId, msg).catch(() => {}); }

function join(tabId, server, room, name) {
  leave(tabId);
  return new Promise(resolve => {
    let ws;
    try { ws = new WebSocket(wsUrl(server)); } catch (e) { return resolve({ ok: false, error: 'URL serveur invalide' }); }
    const s = { ws, room, name, id: null, host: null, offset: 0, keep: null };
    sessions.set(tabId, s);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name, kind: 'player' }));
    ws.onerror = () => resolve({ ok: false, error: 'serveur injoignable' });
    ws.onclose = () => { clearInterval(s.keep); if (sessions.get(tabId) === s) sessions.delete(tabId); toTab(tabId, { t: 'disconnected' }); };
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.t === 'welcome') {
        s.id = m.id; s.host = m.host; s.offset = m.serverTime - Date.now(); // décalage d'horloge approximatif
        s.keep = setInterval(() => ws.readyState === 1 && ws.send('{"t":"ping"}'), 20000); // garde le service worker éveillé
        toTab(tabId, { t: 'welcome', id: m.id, host: m.host, offset: s.offset, mode: m.mode });
        resolve({ ok: true });
      } else if (m.t === 'error') resolve({ ok: false, error: m.msg });
      else if (m.t === 'host') { s.host = m.id; toTab(tabId, m); }
      else if (['sync', 'state-request', 'reaction', 'mode', 'align', 'chat'].includes(m.t)) toTab(tabId, m);
    };
  });
}
function leave(tabId) { const s = sessions.get(tabId); if (s) { sessions.delete(tabId); try { s.ws.close(); } catch {} } }

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = msg.tabId ?? sender.tab?.id;
  if (msg.cmd === 'join') { join(tabId, msg.server, msg.room, msg.name).then(reply); return true; }
  if (msg.cmd === 'leave') { leave(tabId); reply({ ok: true }); return; }
  if (msg.cmd === 'status') { const s = sessions.get(tabId); reply(s ? { connected: true, room: s.room, isHost: s.id === s.host, id: s.id, host: s.host, offset: s.offset } : { connected: false }); return; }
  if (msg.cmd === 'sync') { const s = sessions.get(tabId); if (s?.ws.readyState === 1) s.ws.send(JSON.stringify({ t: 'sync', action: msg.action, time: msg.time, playing: msg.playing, rate: msg.rate })); return; }
});
chrome.tabs.onRemoved.addListener(leave);
