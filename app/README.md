# Cowatch — l'appli téléphone (Android, iPhone)

Version d'essai **0.1.0**, branche `app-mobile`. **Pas en ligne, pas sur les stores.** Rien n'est publié sans l'accord de Lucas.

## Le principe (« mode B » de l'étude « Cowatch partout »)
Comme Rave : le site du service (Netflix, Crunchyroll, ADN, Canal+…) s'affiche **dans** l'appli, et Cowatch commande sa vidéo.
Mais **aucun code de Rave n'est repris** : son code appartient à Rave Inc. ; le décompiler ou le copier serait de la contrefaçon
et ferait refuser l'appli par les stores. Tout est écrit pour Cowatch, à partir de notre propre code (le cœur de l'extension).

```
┌──────────── téléphone ────────────┐
│ lecteur : la vraie page du site   │  ← coeur/player.js + coeur/clock.js injectés (calage, direct, réactions, languette)
│   (adresse toujours affichée)     │
├───────────────────────────────────┤      pont natif (Pont.kt / Pont.swift)
│ salon : le panneau de l'extension │  ← coeur/panel.js + engine.js tels quels (groupe, voix, chat, 7 ambiances)
└───────────────────────────────────┘            │
                                       serveur Cowatch (server.js, inchangé)
```

- `app/web/coque.js` remplace l'API `chrome.*` de l'extension : **le cœur tourne sans aucune modification**.
- `app/web/fond.js` fait le travail de `background.js` ; `app/web/app.js` branche la feuille de partage, la notification et le micro.
- `app/outils/assembler-web.sh` fabrique les pages de l'appli à partir du cœur, à chaque construction (une seule source).
- `app/web/sites.json` : la liste blanche (même liste que l'extension, plus `canal-plus.com` pour la connexion Canal+).

## Ce qu'on fait mieux que Rave
| Chez Rave | Chez Cowatch |
| --- | --- |
| Pont natif ouvert à toutes les pages, JavaScript partout | Pont limité aux origines de la liste blanche ; la page du site n'a droit qu'à **lire l'invitation** (testé) ; notre objet `chrome` est invisible pour elle (testé) |
| Mot de passe tapé dans l'appli, sans garantie | Vraie page du service, **adresse affichée en permanence** ; aucun script ne lit les champs ; le gestionnaire de mots de passe du téléphone fonctionne |
| 25 kits de pub et de mesure | **Zéro** : seulement `androidx.core`, `androidx.activity`, `androidx.webkit` |
| Trafic non chiffré autorisé, erreurs de certificat ignorées | HTTPS obligatoire, page refusée si le certificat est douteux |
| Salons publics | Salons privés sur invitation (inchangé) |
| Navigue partout | Hors liste blanche : le lien part dans le navigateur du téléphone |
| Pas de direct français | Calage du direct de l'extension (heure réelle de l'image) |
| Appli « afficher par-dessus », position, contacts… | Permissions : Internet, micro, notification du salon. C'est tout |

## Construire l'APK d'essai
- **Automatique** : chaque envoi sur `app-mobile` lance l'atelier GitHub `.github/workflows/app-android.yml` ;
  l'APK se télécharge dans l'onglet *Actions* du dépôt › dernière exécution › *Artifacts* › `cowatch-android-essai`.
- **Sur un ordinateur** (Android Studio ou JDK 17 + SDK Android) : `cd app/android && ./gradlew assembleDebug`
  → `app/android/app/build/outputs/apk/debug/app-debug.apk`.
- Installation sur le téléphone : autoriser « sources inconnues » pour le fichier, puis l'ouvrir (hors Google Play, comme prévu pour le POC).
- Essai avec le serveur de l'ordinateur (émulateur) : `adb shell am start -n fr.cowatch.app/.MainActivity -e server http://10.0.2.2:8080`.

## Tester sans téléphone
`node server.js` puis `node app/test/coque-e2e.js` : deux téléphones simulés (salon + lecteur injecté, pont natif simulé
par `app/test/natif-simule.js`, même contrat que `Pont.kt`). Vérifie : vidéo détectée, création du salon, invitation par
la feuille de partage, entrée automatique par le lien, voix, lecture / pause / position calées, chat sur la vidéo,
languette qui rouvre le salon, refus des appels interdits depuis la page du site.

## La demi-journée d'essai du mode B (validée par Lucas le 29/10)
Sur 2 téléphones Android, pour Crunchyroll, Netflix et Canal+ (puis ADN) : la vidéo se lance-t-elle ? quelle netteté
(comparer 20 s avec l'appli officielle) ? la page de connexion est-elle la vraie (adresse affichée) ? le calage marche-t-il
(lecture, pause, saut, direct) ? le plein écran garde-t-il la languette ? Comptes saisis par Lucas lui-même.
Résultat de chaque site → `etat` dans `sites.json` (« ok », « flou », « refusé »).

## Ce qui reste ouvert
- **Jamais construit ni essayé sur un vrai téléphone** : la session de travail n'a pas accès aux dépôts Android. Première
  construction par l'atelier GitHub ; les erreurs éventuelles de compilation seront corrigées à ce moment-là.
- **Qualité vidéo** : dans une page affichée par une appli, Netflix et d'autres peuvent limiter la définition (≈ 480p) ou refuser.
- **Connexion Google** (YouTube, « continuer avec Google ») : Google la bloque dans les applis de ce type ; utiliser l'e-mail.
- **Lien d'invitation qui ouvre l'appli** : il faut publier `/.well-known/assetlinks.json` sur le serveur avec l'empreinte de
  la clé de signature (à faire avec la clé définitive). En attendant : `cowatch://j/CODE`, ou coller le lien dans le salon.
- **Identifiant** `fr.cowatch.app` : définitif une fois sur Google Play, à confirmer par Lucas.
- **Icône** : reprise de l'extension (rond rouge-orangé, contraire à la règle de couleurs) : à redessiner par Design.
- **Règles** : conditions d'utilisation des services et règle Google « webview spam » à faire vérifier avant toute publication.
- **iPhone** (`app/ios`, Swift, XcodeGen) : même pont, jamais construit (pas de Mac ici) ; iPhone mis de côté jusqu'au 5/12.
  Limites probables : vidéos protégées (FairPlay) dans l'appli, plein écran natif d'iOS sans nos surcouches, voix en arrière-plan.
