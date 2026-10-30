// Accueil de l'appli : les sites de la liste blanche, groupés. Pas de logos de marques : leurs noms, à notre style.
(async () => {
  const box = document.getElementById('groupes');
  let data;
  try { data = await (await fetch('sites.json')).json(); } catch (e) { box.textContent = 'Liste des sites illisible.'; return; }
  const groupes = new Map();
  for (const s of data.sites) { if (!groupes.has(s.groupe)) groupes.set(s.groupe, []); groupes.get(s.groupe).push(s); }
  for (const [nom, sites] of groupes) {
    const sec = document.createElement('section');
    const h = document.createElement('h2'); h.textContent = nom; sec.append(h);
    const grid = document.createElement('div'); grid.className = 'grid';
    for (const s of sites) {
      const a = document.createElement('a'); a.className = 'tile'; a.href = s.accueil;
      const n = document.createElement('span'); n.className = 'name'; n.textContent = s.nom;
      const d = document.createElement('span'); d.className = 'dom'; d.textContent = s.domaines[0];
      a.append(n, d);
      if (s.etat === 'a-tester') { const t = document.createElement('span'); t.className = 'state'; t.textContent = 'à tester'; a.append(t); }
      grid.append(a);
    }
    sec.append(grid); box.append(sec);
  }
})();

// « Où va ta connexion » : l'appli Android donne ici, et seulement ici, la liste réelle des sites contactés depuis son ouverture.
// Tout est écrit en texte (jamais en HTML) : un nom de site ne peut rien injecter dans la page.
window.cowatchConfiance = d => {
  const sec = document.getElementById('connexion'); if (!sec || !d) return;
  const mo = n => n < 0 ? '?' : n < 1e6 ? Math.max(1, Math.round(n / 1e3)) + ' ko' : (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace('.', ',') + ' Mo';
  const min = Math.max(1, Math.round((Date.now() - (d.depuis || Date.now())) / 60000));
  document.getElementById('cx-resume').textContent =
    `Depuis ${min} min : ${mo(d.envoye)} envoyés, ${mo(d.recu)} reçus par l'appli (voix, vidéo et pages comprises). Rien d'autre ne passe par ta connexion.`;
  const remplir = (id, l, vide) => {
    const ul = document.getElementById(id); ul.replaceChildren();
    if (!l || !l.length) { const li = document.createElement('li'); li.className = 'vide'; li.textContent = vide; ul.append(li); return; }
    for (const x of l) {
      const li = document.createElement('li'), a = document.createElement('span'), b = document.createElement('span');
      a.textContent = String(x.hote); b.textContent = x.n + (x.n > 1 ? ' demandes' : ' demande'); li.append(a, b); ul.append(li);
    }
  };
  remplir('cx-salon', d.salon, 'Rien pour l\'instant.');
  remplir('cx-sites', d.sites, 'Aucun site ouvert pour l\'instant.');
  const bl = document.getElementById('cx-bloques'), nb = (d.bloques || []).reduce((t, x) => t + x.n, 0);
  bl.hidden = !nb; bl.textContent = nb ? `${nb} demande(s) du salon vers une autre adresse bloquée(s) : ${(d.bloques || []).map(x => x.hote).join(', ')}.` : '';
  sec.hidden = false;
};
