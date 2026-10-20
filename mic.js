// Petite fenêtre ouverte automatiquement la première fois : le panneau latéral ne peut pas afficher la demande d'accès au micro.
navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
  s.getTracks().forEach(t => t.stop());
  document.getElementById('t').textContent = 'Micro autorisé ✓';
  document.getElementById('d').textContent = 'Tu peux parler dans le salon.';
  chrome.runtime.sendMessage({ cmd: 'micGranted' }).catch(() => {});
  setTimeout(() => window.close(), 1200);
}).catch(e => {
  const mac = /Mac/.test(navigator.platform);
  document.getElementById('t').textContent = e && e.name === 'NotFoundError' ? 'Aucun micro trouvé' : 'Micro bloqué';
  document.getElementById('d').textContent = e && e.name === 'NotFoundError' ? 'Branche un casque ou des écouteurs avec micro, puis réessaie.'
    : 'Clique sur l\'icône à gauche de la barre d\'adresse, autorise le micro, puis recharge cette page.' + (mac ? ' Sur Mac, vérifie aussi Réglages Système › Confidentialité › Micro › Chrome.' : '');
});
