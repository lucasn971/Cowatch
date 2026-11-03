# Installer Cowatch sur ton iPhone depuis ton Mac (gratuit)

Pour Lucas. Durée : 30 à 45 min la première fois (surtout le téléchargement de Xcode), 5 min ensuite.
Gratuit : compte Apple ordinaire, pas d'abonnement développeur (99 $/an = seulement pour TestFlight ou l'App Store, décision à part).
Limites du compte gratuit : l'appli **s'arrête au bout de 7 jours** (il suffit de refaire l'étape 6), 3 applis perso maximum sur l'iPhone.

## 1. Préparer le Mac (une seule fois)
1. App Store du Mac → chercher **Xcode** → Obtenir (gratuit, ≈ 10 Go, compter 20-40 min).
2. Ouvrir Xcode une fois, accepter la licence, laisser installer les composants. S'il propose « iOS » dans les plateformes à télécharger, accepter.
3. Xcode → menu **Xcode › Settings › Accounts** → « + » → **Apple ID** → te connecter avec ton compte Apple habituel. *(C'est toi qui tapes ton mot de passe, jamais Claude.)*
4. Installer Homebrew puis XcodeGen, dans l'appli **Terminal** :
   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install xcodegen node
   ```

## 2. Récupérer le code (branche `app-mobile`)
Dans Terminal :
```
cd ~/Documents
git clone -b app-mobile https://github.com/lucasn971/salon.-coche-private- cowatch
cd cowatch/app/ios
```
(Si le dépôt est passé en privé, GitHub demandera de te connecter : suis ses instructions.)
Les fois suivantes : `cd ~/Documents/cowatch && git pull`, puis `cd app/ios`.

## 3. Fabriquer le projet Xcode
```
bash ../outils/assembler-web.sh build-web/www
xcodegen generate
open Cowatch.xcodeproj
```

## 4. Signer avec ton compte gratuit (une seule fois)
Dans Xcode : clic sur **Cowatch** (en haut à gauche) → cible **Cowatch** → onglet **Signing & Capabilities** :
- cocher **Automatically manage signing** ;
- **Team** : choisir « Lucas … (Personal Team) ».
- Si Xcode affiche une erreur sur l'identifiant `fr.cowatch.app` (déjà pris), remplacer par `fr.cowatch.app.essai` et relancer.

## 5. Préparer l'iPhone (une seule fois)
1. Brancher l'iPhone au Mac avec le câble, déverrouiller, toucher **« Se fier à cet ordinateur »**.
2. Sur l'iPhone : **Réglages › Confidentialité et sécurité › Mode développeur** → activer → l'iPhone redémarre → confirmer.
   (Le menu n'apparaît qu'après le premier branchement à Xcode : si tu ne le vois pas, fais l'étape 6 une fois, puis reviens ici.)

## 6. Installer
Dans Xcode, en haut au milieu, choisir **ton iPhone** comme destination, puis le bouton **▶︎ (Run)**.
La 1re fois, l'iPhone refuse d'ouvrir l'appli : **Réglages › Général › VPN et gestion de l'appareil** → ton compte → **Faire confiance**. Relancer ▶︎.

## 7. Si ça bloque
- « Untrusted Developer » → étape 6, dernière ligne.
- « Could not launch… Developer Mode » → étape 5.2.
- Erreur rouge à la compilation → copie le message dans le fil commun (ordre pour Ingé cowatch). L'atelier GitHub « Appli iPhone (construction d'essai) » vérifie à chaque envoi que le code compile.
- Au bout de 7 jours l'appli ne s'ouvre plus → rebrancher et refaire l'étape 6.

Ce que l'appli fait : accueil Cowatch → tu touches un service (Netflix, Crunchyroll, ADN, Canal+…) → **son vrai site** s'ouvre dans l'appli, tu te connectes toi-même, et le salon s'affiche dessous. Aucun lecteur maison, aucun code de Rave. Points à essayer : `app/ios/ESSAI.md`.
