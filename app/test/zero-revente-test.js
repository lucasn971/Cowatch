// Le garde-fou « zéro revente » attrape-t-il vraiment les travers vus chez Rave ? On plante chaque faute dans une copie du dépôt.
// Lancement : node app/test/zero-revente-test.js
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, spawnSync } = require('child_process');
const DEPOT = path.join(__dirname, '../..');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const lancer = (racine, args = []) => spawnSync('node', [path.join(DEPOT, 'zero-revente.js'), ...args], { env: { ...process.env, COWATCH_RACINE: racine }, encoding: 'utf8' });

function copie() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-zr-'));
  execFileSync('bash', ['-c', `git -C "${DEPOT}" ls-files -z | (cd "${DEPOT}" && xargs -0 tar cf -) | tar xf - -C "${d}"`]);
  for (const f of ['zero-revente.js']) if (fs.existsSync(path.join(DEPOT, f))) fs.copyFileSync(path.join(DEPOT, f), path.join(d, f));
  execFileSync('bash', ['-c', `cd "${d}" && git init -q && git add -A`]);
  return d;
}
const ajouter = (d, f, texte) => { fs.appendFileSync(path.join(d, f), texte); execFileSync('git', ['-C', d, 'add', '-A']); };
const remplacer = (d, f, a, b) => { const p = path.join(d, f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(a, b)); execFileSync('git', ['-C', d, 'add', '-A']); };

const r0 = lancer(DEPOT);
ok(r0.status === 0 && /PASS/.test(r0.stdout), 'le dépôt actuel passe le garde-fou');

const cas = [
  ['un kit de bande passante (Honeygain) dans le cœur', d => ajouter(d, 'coeur/player.js', "\nconst hg = require('@honeygain/node-sdk');\n"), /kit interdit « honeygain »/i],
  ['un kit de revente (Mellowtel) dans l\'appli web', d => ajouter(d, 'app/web/app.js', "\nimport('mellowtel-electron');\n"), /mellowtel/i],
  ['une régie de pub (AdMob) dans Gradle', d => remplacer(d, 'app/android/app/build.gradle.kts', 'implementation("androidx.webkit:webkit:1.12.1")', 'implementation("androidx.webkit:webkit:1.12.1")\n    implementation("com.google.android.gms:play-services-ads:23.0.0")'), /play-services-ads|bibliothèque Android en trop/],
  ['un outil de mesure (Sentry) dans le panneau', d => ajouter(d, 'panel.html', '\n<script src="https://browser.sentry-cdn.com/7.0.0/bundle.min.js"></script>\n'), /sentry/i],
  ['une adresse inconnue contactée par le moteur', d => ajouter(d, 'engine.js', "\nfetch('https://collecte.exemple.com/x');\n"), /collecte\.exemple\.com/],
  ['une lecture du presse-papiers (façon clipboard-watcher)', d => ajouter(d, 'app/web/app.js', '\nnavigator.clipboard.readText().then(() => {});\n'), /presse-papiers/],
  ['une lecture du presse-papiers Android', d => ajouter(d, 'app/android/app/src/main/java/fr/cowatch/app/Pont.kt', '\n// x\nval t = cm.primaryClip?.getItemAt(0)\n'), /presse-papiers Android/],
  ['une permission Android de plus (position)', d => remplacer(d, 'app/android/app/src/main/AndroidManifest.xml', '<uses-permission android:name="android.permission.INTERNET" />', '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />'), /ACCESS_FINE_LOCATION/],
  ['une permission d\'extension de plus (historique)', d => remplacer(d, 'manifest.json', '"storage",', '"storage",\n    "history",'), /permission d'extension en trop : history/],
  ['un accès de l\'extension à tous les sites', d => remplacer(d, 'manifest.json', '"*://*.netflix.com/*",', '"*://*.netflix.com/*",\n    "<all_urls>",'), /hors liste : <all_urls>/],
  ['une dépendance au serveur', d => remplacer(d, 'package.json', '"private": true,', '"private": true,\n  "dependencies": { "geonode-sdk": "2.0.1" },'), /sans dépendance/],
  ['une bibliothèque iPhone (Swift Package)', d => ajouter(d, 'app/ios/project.yml', '\npackages:\n  Pub:\n    url: x\n'), /bibliothèque iPhone/],
];
for (const [nom, planter, attendu] of cas) {
  const d = copie();
  try { planter(d); const r = lancer(d); ok(r.status === 1 && attendu.test(r.stdout), `attrapé : ${nom}`); if (r.status !== 1 || !attendu.test(r.stdout)) console.log(r.stdout.slice(0, 600)); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
}

// En construction : le manifeste fusionné par Gradle (permissions ajoutées par une bibliothèque) et les bibliothèques résolues.
const d = copie();
try {
  const mf = path.join(d, 'fusionne.xml');
  fs.writeFileSync(mf, '<manifest><uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="fr.cowatch.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"/></manifest>');
  const deps = path.join(d, 'deps.txt');
  fs.writeFileSync(deps, '+--- androidx.webkit:webkit:1.12.1\n|    +--- androidx.core:core:1.13.1\n');
  ok(lancer(d, ['--manifeste', mf, '--deps', deps]).status === 0, 'construction propre : manifeste fusionné et bibliothèques résolues acceptés');
  fs.writeFileSync(mf, '<manifest><uses-permission android:name="android.permission.READ_CONTACTS"/></manifest>');
  ok(/READ_CONTACTS/.test(lancer(d, ['--manifeste', mf]).stdout), 'attrapé : permission ajoutée en douce par une bibliothèque (manifeste fusionné)');
  fs.writeFileSync(deps, '+--- androidx.webkit:webkit:1.12.1\n\\--- io.repocket:sdk:2.1\n');
  ok(/repocket/i.test(lancer(d, ['--deps', deps]).stdout), 'attrapé : kit tiré par une autre bibliothèque (Repocket)');
} finally { fs.rmSync(d, { recursive: true, force: true }); }
