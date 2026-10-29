// Cowatch — réglages de l'écran du salon propres à l'appli (chargé avant coeur/panel.js, sans le modifier).
(() => {
  const C = chrome.__coque;
  document.documentElement.classList.add('app');
  const layout = new URLSearchParams(location.search).get('layout');
  if (layout) document.documentElement.dataset.layout = layout; // « bas » (téléphone en portrait) ou « cote » (paysage)
  C.on('layout', d => { if (d && d.layout) document.documentElement.dataset.layout = d.layout; });

  // 1. Suivre l'état du salon sans toucher au panneau : on se glisse entre le moteur et le panneau.
  //    panel.js écrit self.__cowatchEmit = ui avant de charger engine.js, qui le lit une fois.
  let emit = null, wrapped = null, last = '';
  Object.defineProperty(self, '__cowatchEmit', {
    configurable: true,
    get: () => wrapped,
    set: fn => { emit = fn; wrapped = ev => { observe(ev); return emit && emit(ev); }; },
  });
  function observe(ev) {
    if (!ev || ev.ev !== 'snap' || !ev.state) return;
    const s = ev.state;
    const room = { inRoom: !!s.inRoom, code: s.code || '', muted: !!s.muted, needMic: !!s.needMic, theme: s.theme || '', peers: (s.peers || []).length };
    const key = JSON.stringify(room); if (key === last) return; last = key;
    C.call('room.state', room); // l'appli garde l'écran allumé et affiche la notification du salon (voix, quitter)
  }
  const engine = cmd => self.__cowatchEngine && self.__cowatchEngine.handle(cmd);
  // Boutons de la notification du salon, et retour de la demande d'accès au micro.
  C.on('leave', () => engine({ cmd: 'leave' }));
  C.on('mute', () => engine({ cmd: 'mute' }));
  C.on('micGranted', () => engine({ cmd: 'micGranted' }));

  // 2. Inviter : sur téléphone, le lien part par la feuille de partage (WhatsApp, Discord, SMS…), pas seulement le presse-papiers.
  const clip = { writeText: text => C.call('clip', { text: String(text), share: /\/j\/[A-Za-z0-9-]{3,24}/.test(String(text)) }).then(r => { if (!r || !r.ok) throw new Error('clip'); }) };
  try { Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true }); } catch (e) { try { navigator.clipboard.writeText = clip.writeText; } catch (e2) {} }

  // 3. Le micro : l'autorisation est demandée par le téléphone lui-même (pas de fenêtre « mic.html »).
  try {
    const q = navigator.permissions && navigator.permissions.query && navigator.permissions.query.bind(navigator.permissions);
    if (q) navigator.permissions.query = d => (d && d.name === 'microphone') ? C.call('mic.state').then(r => ({ state: (r && r.state) || 'prompt' })) : q(d);
  } catch (e) {}
})();
