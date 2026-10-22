// Cowatch — les ambiances (passation Design du 22/10). Une seule structure, plusieurs thèmes :
// seuls changent les couleurs, les polices, les rayons, les textes et le jeu d'émojis.
// Partagé par le panneau (panel.js) et par les surcouches sur la vidéo (player.js).
// Couleurs interdites (identités d'autres marques) : orange Crunchyroll, rouge vif Netflix / Canal+, bleu dominant, violet Twitch.
(() => {
  const THEMES = {
    vestiaire: {
      name: 'Vestiaire', desc: 'Les soirs de match, entre chums. Prono, cri, débrief.',
      bg: '#060A1C', surface: '#101A3C', border: '#26315A', text: '#F4F6FA', muted: '#C3C9D6',
      accent: '#F4F6FA', accentInk: '#060A1C', speaking: '#7CE0A3', wink: '#DA2B3A',
      display: "'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif", body: "Barlow, system-ui, sans-serif",
      gfont: 'family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600;700',
      upper: true, radius: '10px', pill: '99px',
      emojis: ['⚽', '🔥', '😤', '🙌', '🧤', '🫣'], labels: ['But', 'Feu', 'Rage', 'Bravo', 'Arrêt du gardien', 'Je regarde pas'],
      invite: 'Convoquer un pote', placeholder: 'Crie un truc…', groupWord: 'Le groupe',
      card: '<span class="cw-c1" style="font:800 24px/0.86 var(--cw-display);text-transform:uppercase">Ce soir,<br>on joue.</span><span class="cw-c2" style="font:800 16px var(--cw-display)">2-1</span>',
      cardBg: 'radial-gradient(90% 120% at 50% 0%, #1B2A5E 0%, #0C1433 45%, #060A1C 100%)',
    },
    salle: {
      name: 'Salle obscure', desc: 'Les films, comme au cinéma. Discret et élégant.',
      bg: '#08080A', surface: '#1C1D21', border: '#2A2B30', text: '#F1ECE3', muted: '#D4D7DC',
      accent: '#CDB58A', accentInk: '#08080A', speaking: '#CDB58A',
      display: "'Bodoni Moda', Georgia, serif", body: "Jost, system-ui, sans-serif", displayItalic: true,
      gfont: 'family=Bodoni+Moda:ital,opsz,wght@1,6..96,400&family=Jost:wght@300;400;500',
      upper: false, radius: '3px', pill: '3px',
      emojis: ['👏', '😱', '😢', '🤯', '🔥', '🍿'], labels: ['Bravo', 'Frisson', 'Émotion', 'Choc', 'Feu', 'Pop-corn'],
      invite: 'Inviter', placeholder: 'Chatter…', groupWord: 'La salle',
      card: '<span class="cw-c1" style="font:italic 24px var(--cw-display);width:100%;text-align:center;left:0;top:34%">la séance</span>',
      cardBg: 'linear-gradient(180deg, #121317 0%, #08080A 100%)',
    },
    canape: {
      name: 'Soirée canapé', desc: 'Les séries à plusieurs, sans prise de tête.',
      bg: '#17121F', surface: '#221A2D', border: '#3B3442', text: '#FFF4E6', muted: '#D3C7E3',
      accent: '#FFC23D', accentInk: '#17121F', speaking: '#FFC23D',
      display: "'Bricolage Grotesque', system-ui, sans-serif", body: "Figtree, system-ui, sans-serif",
      gfont: 'family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Figtree:wght@400;500;600;700',
      upper: false, radius: '22px', pill: '99px',
      emojis: ['😱', '😂', '💔', '👀', '🔥', '🍿'], labels: ['Choc', 'Rire', 'Cœur brisé', 'Suspicion', 'Feu', 'Pop-corn'],
      invite: 'Ramène un pote', placeholder: 'Balance ton avis…', groupWord: 'Sur le canap\'',
      card: '<span class="cw-c1" style="font:800 20px/0.95 var(--cw-display)">3 sur<br>le canap\'</span><span class="cw-c2" style="left:auto;right:10px;font-size:22px">😂</span>',
      cardBg: '#1E1828',
    },
    live: {
      name: 'Live', desc: 'La téléréalité en direct, entre copines.',
      bg: '#141114', surface: '#1E181D', border: '#3A2F36', text: '#F6EEF0', muted: '#CFC4CB',
      accent: '#E9C3CB', accentInk: '#141114', speaking: '#E9C3CB',
      display: "'Instrument Serif', Georgia, serif", body: "Manrope, system-ui, sans-serif", displayItalic: true,
      gfont: 'family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700',
      upper: false, radius: '18px', pill: '99px',
      emojis: ['🐍', '💅', '😱', '💔', '👀', '🫢'], labels: ['Serpent', 'Classe', 'Choc', 'Cœur brisé', 'Suspicion', 'Oups'],
      invite: 'Inviter sur le plateau', placeholder: 'Ton avis en direct…', groupWord: 'Le plateau',
      card: '<span class="cw-c1" style="font:italic 24px/0.9 var(--cw-display)">Le plateau</span><span class="cw-c2" style="background:#E9C3CB;color:#141114;border-radius:99px;padding:3px 9px;font:13px var(--cw-display)">Elle part.</span>',
      cardBg: 'radial-gradient(80% 110% at 70% 20%, #3A2A33 0%, #1E181D 55%, #141114 100%)',
    },
    arene: {
      name: 'Arène', desc: 'Les streams et tournois. Plus ça crie, plus ça monte.',
      bg: '#0B0E14', surface: '#161C27', border: '#263044', text: '#F2F5FA', muted: '#8893A6',
      accent: '#D4FF3A', accentInk: '#07090D', speaking: '#D4FF3A',
      display: "Archivo, 'Arial Narrow', system-ui, sans-serif", body: "'Space Grotesk', system-ui, sans-serif", displayStretch: '62%',
      gfont: 'family=Archivo:wdth,wght@62..125,900&family=Space+Grotesk:wght@400;500;600;700',
      upper: true, radius: '0px', pill: '0px',
      emojis: ['🎮', '💀', '😤', '🔥', '🏆', '🤡'], labels: ['Manette', 'Mort', 'Rage', 'Feu', 'Victoire', 'Clown'],
      invite: 'Inviter dans l\'arène', placeholder: 'Écris dans le chat…', groupWord: 'L\'arène',
      card: '<span class="cw-c1" style="font:900 26px/0.85 var(--cw-display);font-stretch:62%;text-transform:uppercase">L\'arène</span><span class="cw-c2" style="display:flex;gap:3px;align-items:flex-end;height:26px"><i style="width:8px;height:40%;background:#263044"></i><i style="width:8px;height:100%;background:#D4FF3A"></i><i style="width:8px;height:70%;background:#D4FF3A"></i><i style="width:8px;height:50%;background:#3AD1FF"></i></span>',
      cardBg: '#0B0E14',
    },
    // Manga : cible n°1, mais la couleur (Simulcast jade ou Encre) n'est pas encore tranchée → pas encore sélectionnable.
    manga: {
      name: 'Manga', desc: 'L\'épisode de la semaine, entre fans d\'anime et de manga.', soon: true,
      bg: '#0E0E10', surface: '#1A1A1E', border: '#2A2A30', text: '#F2F2F0', muted: '#A9A9B0',
      accent: '#F2F2F0', accentInk: '#0E0E10', speaking: '#F2F2F0',
      display: "system-ui, sans-serif", body: "system-ui, sans-serif", gfont: '',
      upper: false, radius: '8px', pill: '99px',
      emojis: ['😭', '🔥', '💀', '🙏', '⚡', '😳'], labels: ['Larmes', 'Feu', 'Mort', 'Pitié', 'Hype', 'Gêne'],
      invite: 'Inviter quelqu\'un', placeholder: 'Écris un message…', groupWord: 'Le groupe',
      card: '<span class="cw-c1" style="font:700 15px system-ui;opacity:.7">Bientôt</span>',
      cardBg: 'linear-gradient(180deg, #1A1A1E 0%, #0E0E10 100%)',
    },
  };
  const ORDER = ['vestiaire', 'salle', 'canape', 'live', 'arene', 'manga'];
  const DEFAULT = 'vestiaire';
  const get = id => THEMES[id] && !THEMES[id].soon ? THEMES[id] : THEMES[DEFAULT];
  // Variables CSS d'une ambiance (préfixe --cw-), appliquées au panneau et aux surcouches.
  function vars(id) {
    const t = get(id);
    return { '--cw-bg': t.bg, '--cw-surface': t.surface, '--cw-border': t.border, '--cw-text': t.text, '--cw-muted': t.muted,
      '--cw-accent': t.accent, '--cw-accent-ink': t.accentInk, '--cw-speaking': t.speaking, '--cw-display': t.display, '--cw-body': t.body,
      '--cw-radius': t.radius, '--cw-pill': t.pill, '--cw-upper': t.upper ? 'uppercase' : 'none', '--cw-italic': t.displayItalic ? 'italic' : 'normal',
      '--cw-stretch': t.displayStretch || 'normal' };
  }
  const api = { THEMES, ORDER, DEFAULT, get, vars, valid: id => !!THEMES[id] && !THEMES[id].soon };
  if (typeof module !== 'undefined') module.exports = api; else self.CowatchThemes = api;
})();
