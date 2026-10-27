// Cowatch — réception des réponses aux sondages dans un Google Sheet.
// À coller dans : Google Sheet « Cowatch sondages » > Extensions > Apps Script.
// Puis : Déployer > Nouveau déploiement > Application Web
//        Exécuter en tant que : Moi · Qui a accès : Tout le monde.
// Chaque réponse ajoute une ligne dans l'onglet « Anime » ou « Télé-réalité ».

const CLE = 'cowatch-sondage-2026'; // doit être identique à SONDAGE_CLE dans server.js

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.cle !== CLE) return reponse({ ok: false, erreur: 'cle' });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const nom = d.track === 'anime' ? 'Anime' : 'Télé-réalité';
    const feuille = ss.getSheetByName(nom) || ss.insertSheet(nom);

    // Une colonne par question ; les réponses multiples sont séparées par des virgules.
    const ligne = { date: d.date, src: d.src || '', version: d.v || 1, duree_s: d.duree_s }; // src : discord, reddit… (lien ?src=)
    Object.keys(d.answers || {}).forEach(function (k) {
      const v = d.answers[k];
      ligne[k] = Array.isArray(v) ? v.join(', ') : v;
    });

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      let entetes = feuille.getLastRow() > 0
        ? feuille.getRange(1, 1, 1, feuille.getLastColumn()).getValues()[0]
        : [];
      Object.keys(ligne).forEach(function (k) {
        if (entetes.indexOf(k) === -1) {
          entetes.push(k);
          feuille.getRange(1, entetes.length).setValue(k).setFontWeight('bold');
        }
      });
      feuille.appendRow(entetes.map(function (k) { return ligne[k] === undefined ? '' : ligne[k]; }));
    } finally {
      lock.releaseLock();
    }
    return reponse({ ok: true });
  } catch (err) {
    return reponse({ ok: false, erreur: String(err) });
  }
}

function doGet() {
  return reponse({ ok: true, info: 'Cowatch sondages : en service' });
}

function reponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
