/**
 * Cowatch — statistiques de séance envoyées par e-mail (CSV) aux data analysts.
 * Gratuit : tourne dans le Google Drive de Lucas et envoie les mails depuis son Gmail (100 envois par jour au maximum).
 *
 * Mise en place (une seule fois, 5 minutes) :
 *  1. https://script.google.com → « Nouveau projet » → coller tout ce fichier à la place du code présent → Enregistrer.
 *  2. Remplir ANALYSTES ci-dessous (adresses séparées par des virgules), puis Enregistrer.
 *  3. « Déployer » → « Nouveau déploiement » → type « Application Web » ; Exécuter en tant que : « Moi » ;
 *     Qui a accès : « Tout le monde » → Déployer → autoriser avec son compte Google → copier l'adresse (…/exec).
 *  4. Donner cette adresse à Claude (ou la mettre dans Render : variable TELEMETRY_URL).
 * Test : dans l'éditeur, choisir la fonction « testEnvoi » puis « Exécuter » : un e-mail d'exemple arrive.
 */
const ANALYSTES = 'lucasnourypro@gmail.com';    // ta propre adresse : la conversation « Data analyst » du projet Claude lit le libellé « Data Cowatch »
const CLE = 'cowatch-stats-2026';                // doit être la même que TELEMETRY_KEY sur le serveur (valeur par défaut)
const LIBELLE = 'Data Cowatch';                  // libellé Gmail où sont rangés tous les e-mails de statistiques (hors boîte de réception)

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return reponse({ ok: false, erreur: 'json' }); }
  if (!d || d.key !== CLE || !d.session) return reponse({ ok: false, erreur: 'cle' });
  envoyer(d);
  return reponse({ ok: true });
}

function envoyer(d) {
  const s = d.session, jour = Utilities.formatDate(new Date(s.debut), 'Europe/Paris', 'yyyy-MM-dd HH:mm');
  const fichiers = [
    csv('seance_' + s.id + '.csv', [s]),
    csv('participants_' + s.id + '.csv', d.participants || []),
    csv('evenements_' + s.id + '.csv', d.evenements || []),
  ];
  const minutes = Math.round((s.duree_s || 0) / 60);
  const texte = [
    'Séance Cowatch du ' + jour + ' (heure de Paris)',
    '',
    'Durée : ' + minutes + ' min · participants : ' + s.participants + ' (dont ' + s.avec_video + ' avec la vidéo reliée)',
    'Site : ' + (s.sites || 'inconnu') + ' · mode : ' + (s.modes || '?') + ' · ambiance : ' + (s.ambiance || '?'),
    'Réactions : ' + s.reactions + ' · messages : ' + s.messages + ' · BUUUTS : ' + s.buts,
    'Calages : ' + s.calages + ' (écart max ' + s.ecart_max_s + ' s) · calages bloqués : ' + s.calagesBloques + ' · reconnexions : ' + s.reconnexions,
    '',
    'Fichiers joints : la séance (1 ligne), les participants (1 ligne chacun, anonymes), les événements (1 ligne par événement).',
    'Aucun message, aucune voix, aucun pseudo : chaque participant est un identifiant au hasard.',
    '',
    // Les mêmes données en texte, pour qu'une analyse puisse les lire sans ouvrir les pièces jointes.
    '=== seance.csv ===', texteCsv([s]), '', '=== participants.csv ===', texteCsv(d.participants || []), '', '=== evenements.csv ===', texteCsv(d.evenements || []),
  ].join('\n');
  GmailApp.sendEmail(ANALYSTES, 'Cowatch — séance du ' + jour + ' (' + minutes + ' min, ' + s.participants + ' pers.)', texte, { attachments: fichiers, name: 'Cowatch Data' });
  ranger();
}

// Range les e-mails de statistiques (envoyés, et reçus si tu es aussi destinataire) dans « Data Cowatch », hors de la boîte de réception.
function ranger() {
  Utilities.sleep(3000); // le temps que Gmail enregistre l'envoi
  const lib = GmailApp.getUserLabelByName(LIBELLE) || GmailApp.createLabel(LIBELLE);
  const fils = GmailApp.search('subject:"Cowatch — séance du" -label:"' + LIBELLE + '" newer_than:2d', 0, 50);
  if (!fils.length) return;
  lib.addToThreads(fils);
  GmailApp.moveThreadsToArchive(fils);
}

// Tableau d'objets -> fichier CSV (séparateur « ; » pour Excel en français, UTF-8 avec BOM).
function csv(nom, lignes) { return Utilities.newBlob('\uFEFF' + texteCsv(lignes), 'text/csv', nom); }
function texteCsv(lignes) {
  const cols = [];
  lignes.forEach(function (l) { Object.keys(l).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
  const esc = function (v) { v = v === undefined || v === null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols.join(';')].concat(lignes.map(function (l) { return cols.map(function (c) { return esc(l[c]); }).join(';'); })).join('\r\n');
}

function reponse(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function testEnvoi() {
  envoyer({ session: { id: 'exemple', debut: new Date().toISOString(), fin: new Date().toISOString(), duree_s: 3600, participants: 2, avec_video: 2,
    web_sans_extension: 0, max_simultanes: 2, modes: 'live', ambiance: 'vestiaire', sites: 'canalplus.com', reactions: 42, messages: 12, buts: 2,
    var: 0, pronos: 2, recaps: 1, calages: 3, calagesBloques: 0, reconnexions: 1, themes: 0, ecart_max_s: 6.0, accords: 2 },
    participants: [{ id: 'a1b2c3d4e5f6', panneau: 1, video: 1, site: 'canalplus.com', version: '0.9.2', navigateur: 'Google Chrome 156', systeme: 'macOS', micro: 'ouvert', heureReelle: 'oui', soucis: '' }],
    evenements: [{ heure: new Date().toISOString(), type: 'calage', qui: '', detail: 'arrival ecart 6.00 s' }] });
}
