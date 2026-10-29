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
