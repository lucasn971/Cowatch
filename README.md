# Salon — regarder ensemble à distance (v0.3)

**Modèle « à la Teleparty »** : chacun va sur la plateforme (Canal+, Paramount+, TF1+…) avec son propre compte,
ouvre l'extension Salon, et retrouve dans un **panneau latéral** : voix, chat écrit, réactions, lecture synchronisée
(séries) ou alignement anti-spoil (matchs en direct). Aucune vidéo ne passe par nos serveurs.

## Parcours utilisateur
1. Lucas ouvre son programme sur la plateforme, clique sur l'icône Salon → panneau latéral → « Créer un salon ».
2. « Copier l'invitation » → lien `https://<serveur>/j/CODE?u=<page de la plateforme>`.
3. L'ami ouvre le lien : si l'extension est là, bouton « Rejoindre le salon » → il arrive sur la même page de la plateforme,
   une bulle « Rejoindre le salon CODE » ouvre le panneau, il est connecté automatiquement.
4. Sans extension (téléphone, TV) : « Rejoindre sans extension » → salon web `/s/CODE` (voix + chat, alignement manuel).

## Extension v0.3 (dossier `extension/`, Manifest V3)
- `panel.html/js` : panneau latéral (API `chrome.sidePanel`) — salon, voix WebRTC, chat, réactions, mode série/match, calibration TOP.
- `player.js` : sur les pages des plateformes, repère la vidéo, applique play/pause/avance/alignement, affiche messages et bulle d'invitation.
- `join.js` : sur la page d'invitation `/j/CODE`, remplace « installer » par « rejoindre ».
- `mic.html/js` : autorisation du micro en un clic (le panneau latéral ne peut pas afficher la demande lui-même).
- Sites autorisés : canalplus.com, paramountplus.com, tf1.fr, primevideo.com, youtube.com (pratique pour tester gratuitement), le serveur.

Tests : `node test/e2e-v3.js` (18/18 : invitation, voix, chat, réactions, synchro, alignement) et `node test/e2e-web.js` (salon web, 8/8).

---

## Pourquoi un mode « match »
En direct, personne ne voit l'image au même moment : Canal+ annonce ~10 s de retard en « streaming temps réel »
contre ~40 s en mode standard ; box, TNT, appli et navigateur diffèrent aussi. Celui qui est en avance spoile le but à la voix.
Solution v0.2 : **calibration TOP**. Chacun appuie sur TOP quand il *voit* le même moment (changement du score à l'écran,
coup de sifflet). Le plus tardif = la référence. Chaque personne en avance se met en pause de son avance :
- automatiquement si elle regarde dans Chrome avec l'extension (pause puis relance) ;
- sinon le salon lui affiche « mets pause X s sur ta box ».
Précision attendue : celle d'un réflexe humain (quelques dixièmes de seconde) ; refaire une calibration après une coupure réseau.

## Ce qui marche (testé le 18/10/2026, Chromium, 2 utilisateurs, `node test/e2e.js` : 18/18)
| Brique | État |
|---|---|
| Mode match : calibration TOP, calcul des avances | OK (2,5 s simulées → 2,6 s mesurées) |
| Mode match : pause/relance auto du lecteur en avance, sans gêner les autres | OK |
| Salon vocal WebRTC (pair-à-pair, jusqu'à 8 pers.) | OK : connexion, audio reçu, indicateur « parle » |
| Couper micro / appuyer-pour-parler (espace) | OK |
| Réactions emoji en direct | OK |
| Extension : play / pause / avance partagés | OK (écart mesuré < 0,5 s) |
| Recalage automatique de la dérive (pilote toutes les 3 s) | OK |
| Lien d'invitation `/s/CODE` | OK |

Non testé : **le vrai lecteur Canal+ en direct** (pause du direct autorisée ? sur quelles chaînes ?), le vrai lecteur Paramount+, réseaux 4G, plus de 2 personnes.

## Architecture
```
 Onglet "Salon" (web)  ──voix WebRTC P2P──  Onglet "Salon" des amis
        │ WebSocket                                │
        └──────────── server/server.js ────────────┘
        ┌─────────── (signalisation + relais) ─────┐
 Extension Chrome (onglet Paramount+) ── play/pause/seek/état ── Extensions des amis
```
- **server/** : Node ≥ 18, *aucune dépendance* (WebSocket implémenté à la main). Sert aussi la page web.
- **web/** : `index.html` = salon (voix, réactions). `test-player.html` = faux lecteur pour tester sans Paramount+.
- **extension/** : Manifest V3. Le content script repère la plus grande `<video>` de la page, écoute play/pause/seeked
  et applique les commandes reçues. Le WebSocket vit dans le service worker (évite la CSP des sites).
- Aucune vidéo n'est hébergée ni retransmise : chacun lit avec **son propre abonnement**. Aucun enregistrement audio.

## Lancer en local
```bash
cd server && node server.js          # http://localhost:8080
```
1. Ouvrir `http://localhost:8080` dans deux profils Chrome → même code de salon.
2. `chrome://extensions` → Mode développeur → « Charger l'extension non empaquetée » → dossier `extension/`.
3. Ouvrir `http://localhost:8080/test-player.html` (ou Paramount+), cliquer l'icône → même code + même pseudo.
4. Test automatique : `node test/e2e.js` (Playwright requis).

## Mettre en ligne pour le test (≈ 30 min)
Le micro exige **HTTPS** hors localhost → héberger sur Render / Railway / Fly.io (HTTPS fourni).
`Start command: node server/server.js` — variable `PORT` fournie par l'hébergeur.
Puis, dans la popup de l'extension, mettre l'URL https du serveur.

## Limites connues → chantier technique
1. **Canal+ en direct** : vérifier que la pause du direct (« contrôle du direct ») fonctionne dans Chrome sur CANAL+ / CANAL+ FOOT / CANAL+ LIVE, et que l'extension trouve la `<video>`. Le compte Canal+ standard = 2 écrans simultanés : ne pas partager de compte entre foyers.
2. **Paramount+** : à vérifier sur le vrai lecteur (DRM Widevine : on *contrôle* le lecteur, on ne capture rien —
   mais certains lecteurs n'aiment pas `currentTime` modifié de l'extérieur ; Netflix plante avec ça, il faut passer par son API interne).
   Prévoir un « adaptateur » par plateforme (Paramount+, Prime Video Channels, Canal+).
3. **NAT strict / 4G** : sans serveur TURN, ~10-20 % des connexions vocales peuvent échouer → ajouter un TURN
   (coturn auto-hébergé, ou service managé) avant d'ouvrir à des inconnus.
4. **Au-delà de ~6-8 personnes** : passer d'un maillage P2P à un SFU (LiveKit open source / LiveKit Cloud, mediasoup).
5. **Son de la série capté par le micro** : l'annulation d'écho ne marche que si le son sort du même navigateur.
   Casque recommandé ; appuyer-pour-parler disponible.
6. Deux onglets (salon + lecteur) : v0.3 = panneau latéral de l'extension avec la voix dedans (permission micro à demander une fois via une page de l'extension).
7. Chrome Web Store : publication = compte développeur (frais unique), politique de confidentialité, justification de `<all_urls>`
   (à restreindre aux domaines supportés avant publication).
8. Son du match capté par le micro : très probable pendant un match (TV forte, cris). Casque fortement conseillé ou appuyer-pour-parler.
9. Sécurité : codes de salon devinables (5 caractères) → OK pour un test entre proches, pas pour du public.

## Mesures intégrées
`GET /stats` : salons créés, connexions, réactions, événements de synchro, calibrations, alignements (agrégés, aucune donnée personnelle).
