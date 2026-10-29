# Cowatch — le cœur commun et son protocole

Lot 0 (validé par Lucas le 29/10/2026) : Cowatch est découpé en **un cœur commun** et **une coque par appareil**.
Ce fichier est le contrat que toute nouvelle coque (appli Android, salon web, Safari…) doit respecter.

## 1. Ce qui fait partie du cœur

| Fichier | Rôle | Où il tourne |
| --- | --- | --- |
| `server.js` (+ `stats.js`) | Serveur de salons : HTTP, WebSocket fait main, relais de synchro, calage automatique, réactions, ambiance, pronos, récap, statistiques | Render (`node server.js`) |
| `coeur/player.js` | Repère le lecteur vidéo d'un site, applique play / pause / saut / calage, réactions et surcouches sur la vidéo | Dans la page du site (extension : script de contenu ; Android mode B : script injecté dans la WebView) |
| `coeur/clock.js` | Lit l'« heure réelle » de l'image en direct ; passerelle vers les commandes que seul le lecteur du site accepte (Netflix) | Dans la page du site, monde « MAIN » |
| `coeur/themes.js` | Les 7 ambiances : couleurs, polices, textes, émojis | Partout (panneau, moteur, page du site) |
| `coeur/panel.js`, `coeur/panel.css` | Le salon : groupe, chat, réactions, choix d'ambiance, menu | Extension : panneau latéral (`panel.html`) ; plus tard : écran du salon des autres coques |

**`server.js` reste à la racine** pour l'instant : Render le lance par `node server.js` et `release-main.sh` le modifie à cet endroit. Le déplacer demande de changer la commande de démarrage dans Render (étape à faire avec Lucas, plus tard).

**Coque Chrome (hors du cœur)** : `manifest.json`, `manifest.firefox.json`, `background.js`, `engine.html`/`engine.js` (voix WebRTC et connexion, page cachée « offscreen »), `panel.html` (page d'entrée du panneau), `mic.html`/`mic.js`, `join.js`.
Règle : **rien de propre à Chrome (`chrome.*`) n'entre dans `coeur/` en dehors des appels déjà présents** ; les nouveaux appels `chrome.*` vont dans `background.js` ou `engine.js`. À terme, `panel.js` et `player.js` passeront par une petite couche « coque » (envoyer un message, ouvrir une page) pour tourner aussi dans l'appli Android.

## 2. Connexion

- Adresse : `wss://<serveur>/` (WebSocket, messages en JSON, un objet par message, champ `t` = type).
- Le serveur accepte aussi : `GET /health` (réveil), `GET /ice` (serveurs STUN/TURN pour la voix), `GET /stats` (compteurs sans donnée perso).
- Deux sortes de participants dans un salon :
  - **`salon`** : la personne (panneau, voix, chat). 8 au plus par salon (`ROOM_MAX`, voix en maillage WebRTC).
  - **`player`** : le lecteur vidéo de cette personne (page du site).

## 3. Messages envoyés par une coque

| `t` | Qui | Champs | Effet |
| --- | --- | --- | --- |
| `join` | tous | `room`, `kind` (`salon`/`player`), `name`, `cid` (identifiant stable du navigateur), `avatar`, `theme` (à la création) | Entrer dans le salon ; même `cid` = remplace l'ancienne connexion (pas de doublon) |
| `sync` | player | `action` (play/pause/seek/state), `time`, `playing`, `rate` | Relayé aux autres lecteurs et salons |
| `clock` | player | `pos` (heure réelle de l'image, en s), `paused` | Calage automatique du direct |
| `kind` | player | `live` | Le serveur choisit le mode du salon (série / direct) |
| `mode` | salon | `mode` | Bascule série ↔ match à la main |
| `chat` | salon | `text` | Chat écrit (`/spoil` géré par le panneau) |
| `reaction` | tous | `emoji`, position vidéo | 8 par seconde au plus ; ⚽ en Vestiaire = BUUUT |
| `goal-cancel` | salon | — | VAR (dans les 20 s) |
| `lights` | salon | position vidéo | Feux de départ (Paddock, 1 fois / 15 s) |
| `theme` | salon (créateur) | `theme` | Change l'ambiance |
| `prono` | salon | score | Prono d'avant-match |
| `recap` | salon | score final | Récap de fin de match |
| `calib-start`, `top`, `align` | salon | — | Calage manuel (TV) |
| `signal` | salon | `to`, `data` | Offre / réponse / ICE WebRTC relayés |
| `mute`, `avatar`, `unstable` | salon | — | Pastilles sur l'avatar |
| `telemetry` | tous | rapport anonyme | Gardé seulement avec l'accord |
| `ping` | tous | `c` | Réponse `pong` (mesure d'horloge) |

## 4. Messages envoyés par le serveur

`welcome` (id, nom, pairs, pilote, heure du serveur, mode, ambiance, créateur ?, pronos) · `error` · `peer-joined` / `peer-left` · `host` (lecteur pilote) · `state-request` · `sync` · `align` (`pauseFor` : se mettre en pause N s) · `autosync` / `autosync-stuck` · `mode` · `chat` / `chat-history` · `reaction` · `goal` / `goal-cancel` · `lights` · `theme` · `pronos` · `recap` · `calib-start` / `calib-result` / `aligned` · `signal` · `mute` · `avatar` · `unstable` · `pong`.

## 5. Ce qu'une nouvelle coque doit faire

1. Se connecter deux fois : une fois en `salon` (la personne), une fois en `player` (le lecteur), avec le même code de salon.
2. Côté lecteur : envoyer `sync` à chaque action, `clock` toutes les ~2 s en direct, `kind` au démarrage ; appliquer `sync` et `align` reçus.
3. Côté salon : reprendre `panel.js` / `themes.js` pour l'affichage, la voix via WebRTC (`signal` + `/ice`).
4. Garder les mêmes noms de messages : le serveur ne sait pas quelle coque lui parle.

## 6. Coques prévues (étude « Cowatch partout », 28/10)

- **PC/Mac** : extension Chrome (en ligne). Edge et Firefox : refusés pour l'instant (Lucas, 29/10).
- **Android** (POC) : mode A = appli officielle pilotée (lecture des lecteurs actifs) ; mode B = site du service dans notre appli, avec `player.js` + `clock.js` injectés (demi-journée de test sur Canal+, Netflix, Crunchyroll).
- **iPhone, TV** : salon web compagnon.
