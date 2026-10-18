// Page ouverte une seule fois : le panneau latéral ne peut pas afficher la demande d'accès au micro lui-même.
navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
  s.getTracks().forEach(t => t.stop());
  document.getElementById('t').textContent = 'Micro autorisé ✓';
  document.getElementById('d').textContent = 'Tu peux fermer cet onglet et revenir au panneau Salon.';
  chrome.runtime.sendMessage({ cmd: 'micGranted' }).catch(() => {});
  setTimeout(() => window.close(), 1500);
}).catch(() => {
  document.getElementById('t').textContent = 'Micro refusé';
  document.getElementById('d').textContent = 'Clique sur l\'icône de cadenas dans la barre d\'adresse pour autoriser le micro, puis recharge cette page.';
});
