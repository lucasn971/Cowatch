#!/usr/bin/env node
// Garantie « zéro revente » de Cowatch, vérifiée par une machine à chaque construction (et par `node zero-revente.js`).
// Née de l'analyse de Rave (claude/cowatch-analyse-rave.md) : Rave pour Windows 1.18.28 embarque au moins 12 kits qui
// revendent la connexion Internet de ses utilisateurs, de la pub, du pistage, et surveille le presse-papiers.
// Ce script fait échouer la construction si l'un de ces travers entre dans Cowatch, même par mégarde :
//   1. un kit de « partage de bande passante », de pub ou de pistage (nom, paquet ou adresse) ;
//   2. une adresse contactée qui n'est pas dans la liste ci-dessous (chaque entrée dit pourquoi elle est là) ;
//   3. une lecture du presse-papiers (Cowatch y écrit le lien d'invitation quand on le demande, il ne le lit jamais) ;
//   4. une permission de plus pour l'appli Android ou l'extension, ou une bibliothèque Android / iPhone de plus.
// Usage : node zero-revente.js [--manifeste <AndroidManifest.xml fusionné>] [--deps <sortie de gradle dependencies>]
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const RACINE = process.env.COWATCH_RACINE || __dirname; // COWATCH_RACINE : pour le test qui plante des fautes dans une copie
const erreurs = [];
const faute = (fichier, ligne, texte) => erreurs.push(`${fichier}${ligne ? ':' + ligne : ''} — ${texte}`);

// ---------- 1. Kits interdits (tirés de l'analyse de Rave, plus les régies et outils de pistage courants) ----------
const KITS = [
  // partage de bande passante / proxy résidentiel (Rave Mac 1.17.12 et Windows 1.18.28)
  'honeygain', 'repocket', 'geonode', 'infatica', 'pawns\\.app', 'iproyal', 'switchboard-js', 'cashraven', 'cash raven',
  'getpassive', 'redharvest', 'earnfm', 'fleetshare', 'mellowtel', 'joinmassive', 'rave-massive', 'cocogain', 'hopmn',
  'peer_ffi', 'bslib', 'rpalwi', 'iat-meter', 'web_indexing', 'webindexing', 'bandwidth.?shar',
  'brightdata', 'bright ?sdk', 'luminati', 'packetstream', 'packetshare', 'traffmonetizer', 'earnapp', 'peer2profit',
  'proxyrack', 'bitping', 'proxylite', 'speedshare', 'grass\\.io', 'mysterium',
  // régies publicitaires
  'admob', 'google-mobile-ads', 'play-services-ads', 'applovin', 'ironsource', 'unityads', 'unity3d\\.ads', 'outbrain',
  'taboola', 'doubleclick', 'googlesyndication', 'adsense', 'adx', 'vungle', 'chartboost', 'inmobi', 'mintegral',
  'pangle', 'audience-network', 'facebook\\.net',
  // mesure, attribution, journaux à distance
  'appsflyer', 'branch\\.io', 'io\\.branch', 'adjust\\.com', 'com\\.adjust', 'sentry', 'bugfender', 'mixpanel',
  '@amplitude', 'amplitude\\.com', 'segment\\.(?:io|com)', 'google-analytics', 'googletagmanager', 'gtag\\(',
  'firebase', 'crashlytics', 'hotjar', 'onesignal', 'clevertap', 'braze', 'kochava', 'singular\\.net',
  'systeminformation', 'clipboard-watcher',
];
const RE_KIT = new RegExp(`(?<![a-z0-9])(?:${KITS.join('|')})(?![a-z0-9])`, 'i');

// ---------- 2. Les seules adresses que Cowatch contacte ----------
const sitesApp = JSON.parse(fs.readFileSync(path.join(RACINE, 'app/web/sites.json'), 'utf8'));
const domainesServices = sitesApp.sites.flatMap(s => s.domaines);
const ADRESSES = {
  'salon-coche-private.onrender.com': 'le serveur Cowatch (salons, invitations, sondage)',
  'fonts.googleapis.com': 'polices des ambiances (aucun cookie, aucune donnée de compte)',
  'fonts.gstatic.com': 'fichiers des polices des ambiances',
  'appassets.androidplatform.net': 'pages internes de l\'appli Android (rien ne sort du téléphone)',
  'rtc.live.cloudflare.com': 'clés du relais de voix, demandées par le serveur (jamais le son lui-même)',
  'script.google.com': 'réponses au sondage et statistiques anonymes, envoyées par le serveur vers le Google Sheet de Lucas',
  'localhost': 'essais', '127.0.0.1': 'essais', '10.0.2.2': 'essais sur l\'émulateur Android',
  'x': 'adresse factice pour lire une URL relative (server.js)',
  // espaces de noms XML : du texte, pas une connexion
  'www.w3.org': 'espace de noms SVG/XML', 'schemas.android.com': 'espace de noms Android',
};
const service = h => domainesServices.some(d => h === d || h.endsWith('.' + d));
const adresseOk = h => h in ADRESSES || service(h);

// Les fichiers livrés : l'extension, les pages du serveur, l'appli (web, Android, iPhone). Pas les essais ni la doc.
const fichiers = execFileSync('git', ['ls-files'], { cwd: RACINE, encoding: 'utf8' }).split('\n').filter(Boolean);
const LIVRES = new RegExp([
  '^(background|engine|join|mic|sw|stats|server)\\.js$', '^(index|confidentialite|sondage-[a-z]+|engine|mic|panel|join|installer)\\.html$',
  '^[a-z-]+\\.gs$', '^manifest(\\.firefox)?\\.json$', '^manifest\\.webmanifest$', '^coeur/', '^app/web/',
  '^app/android/(app/)?build\\.gradle\\.kts$', '^app/android/settings\\.gradle\\.kts$', '^app/android/app/src/', '^app/ios/(project\\.yml|Cowatch/)',
  '^\\.github/workflows/',
].join('|'));
const TEXTE = /\.(js|html|json|kt|kts|swift|yml|yaml|xml|gs|plist|css|webmanifest)$/;
const livres = fichiers.filter(f => LIVRES.test(f) && TEXTE.test(f));
if (livres.length < 20) faute('zero-revente.js', 0, `trop peu de fichiers livrés trouvés (${livres.length}) : la liste LIVRES est à revoir`);

// ---------- 3. Lecture du presse-papiers ----------
const LECTURES = [
  [/clipboard\s*\.\s*read(Text)?\s*\(/, 'lecture du presse-papiers (navigator.clipboard.read)'],
  [/getPrimaryClip|\bprimaryClip\b(?!\s*=)/, 'lecture du presse-papiers Android'],
  [/UIPasteboard\.general\.(string|strings|url|urls|image|images|items|hasStrings)\b(?!\s*=[^=])/, 'lecture du presse-papiers iPhone'],
  [/document\.execCommand\(\s*['"]paste/, 'collage forcé'],
  [/getUserMedia\s*\(\s*\{[^}]*\bvideo\s*:\s*(true|\{)|RESOURCE_VIDEO_CAPTURE|AVMediaType\.video|\.camera\b/, 'caméra demandée (Cowatch ne filme jamais)'],
];

for (const f of livres) {
  const lignes = fs.readFileSync(path.join(RACINE, f), 'utf8').split('\n');
  lignes.forEach((l, i) => {
    const n = i + 1, t = l.trim();
    const m = l.match(RE_KIT);
    if (m && f !== 'zero-revente.js') faute(f, n, `kit interdit « ${m[0]} » (revente de connexion, pub ou pistage)`);
    for (const [re, quoi] of LECTURES) if (re.test(l)) faute(f, n, quoi);
    if (/^(#|\/\/|\*|<!--)/.test(t)) return; // un lien dans un commentaire ne se connecte à rien
    for (const u of l.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi)) {
      const h = u[1].toLowerCase().replace(/\.$/, '');
      if (!adresseOk(h)) faute(f, n, `adresse « ${h} » hors de la liste des destinations de Cowatch`);
    }
  });
}

// ---------- 4. Permissions et bibliothèques ----------
const PERMS_ANDROID = ['INTERNET', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MICROPHONE',
  'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'POST_NOTIFICATIONS'].map(p => 'android.permission.' + p);
// androidx.core ajoute d'elle-même une permission interne à l'appli (récepteurs non exportés) : sans effet hors de l'appli.
const permInterne = p => /^fr\.cowatch\.app(\.debug)?\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION$/.test(p);
function verifierPermissions(fichier, attendu) {
  const xml = fs.readFileSync(fichier, 'utf8');
  const vues = [...xml.matchAll(/<uses-permission(?:-sdk-23)?\s[^>]*android:name="([^"]+)"/g)].map(m => m[1]);
  for (const p of vues) if (!attendu.includes(p) && !permInterne(p)) faute(path.relative(RACINE, fichier), 0, `permission Android en trop : ${p}`);
}
verifierPermissions(path.join(RACINE, 'app/android/app/src/main/AndroidManifest.xml'), PERMS_ANDROID);

const DEPS_ANDROID = ['androidx.core:core-ktx', 'androidx.activity:activity-ktx', 'androidx.webkit:webkit'];
const gradle = fs.readFileSync(path.join(RACINE, 'app/android/app/build.gradle.kts'), 'utf8');
for (const m of gradle.matchAll(/^\s*(implementation|api|runtimeOnly|compileOnly|kapt|ksp|annotationProcessor)\s*\(\s*"([^:"]+:[^:"]+)/gm))
  if (!DEPS_ANDROID.includes(m[2])) faute('app/android/app/build.gradle.kts', 0, `bibliothèque Android en trop : ${m[2]}`);
if (/^\s*(implementation|api|runtimeOnly|compileOnly)\s*\(\s*(platform|files|fileTree)\s*\(/m.test(gradle)) faute('app/android/app/build.gradle.kts', 0, 'bibliothèque ajoutée par fichier ou plateforme');
const projetIos = fs.readFileSync(path.join(RACINE, 'app/ios/project.yml'), 'utf8');
if (/^\s*packages\s*:/m.test(projetIos) || fichiers.some(f => /(^|\/)(Podfile|Cartfile|Package\.swift)$/.test(f))) faute('app/ios', 0, 'bibliothèque iPhone ajoutée (CocoaPods, Carthage ou Swift Package)');
const pkg = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'));
for (const k of ['dependencies', 'optionalDependencies', 'peerDependencies']) if (pkg[k] && Object.keys(pkg[k]).length) faute('package.json', 0, `le serveur doit rester sans dépendance (${k})`);

const PERMS_EXT = ['storage', 'tabs', 'sidePanel', 'offscreen', 'scripting'];
for (const mf of ['manifest.json', 'manifest.firefox.json']) {
  const m = JSON.parse(fs.readFileSync(path.join(RACINE, mf), 'utf8'));
  for (const p of [...(m.permissions || []), ...(m.optional_permissions || [])]) if (!PERMS_EXT.includes(p)) faute(mf, 0, `permission d'extension en trop : ${p}`);
  for (const h of [...(m.host_permissions || []), ...(m.optional_host_permissions || [])]) {
    const hote = (h.match(/^[*a-z]+:\/\/(?:\*\.)?([^/:]+)/) || [])[1];
    if (!hote || !adresseOk(hote)) faute(mf, 0, `accès à un site hors liste : ${h}`);
  }
}

// ---------- En construction (atelier GitHub) : ce que l'appli fabriquée contient vraiment ----------
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const mf = arg('--manifeste');
if (mf) { if (!fs.existsSync(mf)) faute(mf, 0, 'manifeste fusionné introuvable'); else verifierPermissions(mf, PERMS_ANDROID); }
const deps = arg('--deps');
if (deps) {
  const t = fs.readFileSync(deps, 'utf8');
  for (const l of t.split('\n')) { const m = l.match(RE_KIT); if (m) faute(deps, 0, `bibliothèque interdite tirée par une autre : « ${m[0]} » dans « ${l.trim()} »`); }
  if (!/androidx\.webkit:webkit/.test(t)) faute(deps, 0, 'liste des bibliothèques illisible (androidx.webkit absent)');
}

if (erreurs.length) {
  console.log(`FAIL zéro revente : ${erreurs.length} problème(s)`);
  for (const e of erreurs) console.log('  - ' + e);
  process.exitCode = 1;
} else {
  console.log(`PASS zéro revente : ${livres.length} fichiers livrés vérifiés — aucun kit de revente, de pub ni de pistage ; `
    + `adresses limitées au serveur Cowatch, aux polices et aux ${sitesApp.sites.length} services ; presse-papiers jamais lu ; `
    + `permissions et bibliothèques inchangées${mf ? ' (manifeste fusionné compris)' : ''}${deps ? ' (bibliothèques résolues comprises)' : ''}.`);
}
