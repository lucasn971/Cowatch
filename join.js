// Sur la page d'invitation (/j/CODE) : l'extension est installée, on remplace le bouton "installer" par "rejoindre".
(() => {
  const box = document.getElementById('join-data'); if (!box) return;
  document.documentElement.dataset.salonExtension = 'installed';
  const code = box.dataset.code, target = box.dataset.target;
  const btn = document.getElementById('join-go'); if (!btn) return;
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ cmd: 'pendingJoin', code });
    if (target) location.href = target; else btn.textContent = 'Salon prêt : ouvre ta plateforme puis clique sur l\'icône Cowatch';
  });
})();
