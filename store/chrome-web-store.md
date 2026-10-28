# Cowatch : dossier Chrome Web Store

Préparé le 28/10/2026 par la conversation Ingé, à la suite de l'accord de Lucas du 27/10 (Chrome Web Store accepté, 5 $ payés par Lucas lui-même). **Claude ne paie rien, ne crée aucun compte et ne saisit aucun mot de passe** : ces étapes sont à faire par Lucas.

## 0. Avant de commencer
1. **Mettre en ligne la page de confidentialité** (`/confidentialite`). Le store exige son adresse : https://salon-coche-private.onrender.com/confidentialite. Elle est prête sur `prochaine-version`. **Il faut l'accord de Lucas pour la mettre en ligne.** Elle ne touche pas à l'extension.
2. **Choisir le compte Gmail du store.** Google conseille un compte dédié, et l'adresse ne pourra plus être changée ensuite.
3. **Choisir l'adresse de contact publique.** La page de confidentialité affiche lucasnourypro@gmail.com (déjà visible dans le dépôt public). Lucas peut en mettre une autre.

## 1. Étapes pour Lucas (≈ 30 min, puis quelques jours d'examen par Google)
1. Ouvrir https://chrome.google.com/webstore/devconsole avec le compte choisi, accepter le contrat, **payer les 5 $** (une seule fois, à vie).
2. **Compte** : nom de l'éditeur « Cowatch », e-mail de contact (à vérifier par le lien reçu). Statut « commerçant / non-commerçant » (règle européenne) : Cowatch est gratuit, sans vente ni publicité. « Non-commerçant » paraît donc le bon choix, mais c'est une déclaration légale : c'est à Lucas de décider.
3. **Nouvel élément** : envoyer `cowatch-store.zip` (version 0.9.3, le même code que celui en ligne).
4. **Fiche** : remplir avec les textes du §2, et ajouter l'icône, les captures et la vignette (§5).
5. **Confidentialité** : remplir avec le §3 et le §4.
6. **Distribution** : gratuit ; visibilité **« Non répertoriée »** (seules les personnes qui ont le lien peuvent installer) ; tous les pays.
7. **Envoyer pour examen.** Comptez quelques jours. Cowatch agit sur 9 sites, ce qui peut entraîner un examen plus approfondi.
8. Quand c'est publié : envoyer le lien du store à l'Ingé, qui fera pointer la page `/installer` vers le store (installation en un clic, mises à jour automatiques).

## 2. Fiche
- **Nom** : Cowatch — regarder ensemble
- **Résumé** (repris du manifeste, 124 caractères) : Regardez Netflix, Prime Video, Canal+, TF1+ ou Disney+ ensemble à distance : voix, chat, réactions et vidéo calée pour tous.
- **Catégorie** : Divertissement
- **Langue** : français
- **Description détaillée** :

> Cowatch te permet de regarder une série, un film ou un match ensemble, chacun chez soi, avec son propre abonnement.
>
> • Un salon en un clic : crée un salon, envoie le lien, tes amis arrivent directement sur la bonne vidéo.
> • Une vidéo calée pour tous : lecture, pause et avance sont partagées. En direct, Cowatch cale automatiquement tout le monde sur la même image.
> • On se parle : voix et chat dans un panneau à côté de la vidéo, même en plein écran.
> • Des réactions sur la vidéo : les émojis montent sur l'image, au bon moment chez chacun, sans spoiler ceux qui ont du retard.
> • Une ambiance pour chaque soirée : Vestiaire (foot, pronos, « BUUUT »), Salle obscure, Soirée canapé, Live, Arène, Anime (/spoil pour flouter un message) et Paddock (feux de départ, radio).
>
> Sites pris en charge : Netflix, Prime Video, Canal+, TF1+, Disney+, Paramount+ et YouTube.
>
> Gratuit et sans publicité. Cowatch ne copie pas la vidéo et ne voit pas tes mots de passe. Les messages et la voix ne sont jamais enregistrés. Statistiques anonymes seulement avec ton accord.
>
> Cowatch n'est pas affilié à Netflix, Amazon, Canal+, TF1, Disney, Paramount ni YouTube.

## 3. Confidentialité : objectif unique et autorisations
- **Objectif unique** : Regarder une vidéo ensemble à distance sur des sites de streaming : un salon partagé avec voix, chat et réactions, et une lecture calée pour tous.
- **storage** : garder sur l'ordinateur le pseudo, la photo facultative, l'ambiance choisie et la réponse sur les statistiques.
- **tabs** : trouver l'onglet qui contient la vidéo et suivre l'onglet affiché, pour que le panneau du salon reste relié à la bonne vidéo. Le titre de l'onglet est seulement affiché dans le panneau : il n'est jamais envoyé.
- **sidePanel** : afficher le salon (groupe, chat, réactions, micro) à côté de la vidéo.
- **offscreen** : garder la connexion du salon et la voix ouvertes quand le panneau est replié (document hors écran pour la voix WebRTC et le micro).
- **scripting** : remettre Cowatch dans les onglets déjà ouverts juste après l'installation ou une mise à jour, sans devoir recharger la page.
- **Autorisations sur les sites** (Netflix, Prime Video / Amazon, Canal+, TF1+, Disney+, Paramount+, YouTube) : trouver le lecteur vidéo de la page, lire sa position et le mettre en lecture ou en pause pour caler tout le salon, puis afficher les réactions et le chat par-dessus la vidéo. Cowatch n'agit sur aucun autre site.
- **salon-coche-private.onrender.com** : c'est le serveur des salons. La page d'invitation sert à rejoindre un salon depuis un lien.
- **Code distant** : **Non**. Tout le code est dans le paquet. Seules des polices de caractères sont téléchargées (Google Fonts).
- **Micro** : demandé par Chrome à la première utilisation de la voix. Ce n'est pas une autorisation du manifeste.

## 4. Confidentialité : données (cases à cocher)
| Catégorie | Cocher ? | Ce qui est concerné |
| --- | --- | --- |
| Informations permettant d'identifier une personne | Oui | Pseudo et photo facultative, montrés aux membres du salon, jamais stockés sur le serveur après la séance |
| Communications personnelles | Oui | Chat et voix, transmis aux membres du salon, jamais enregistrés |
| Activité de l'utilisateur | Oui | Lecture, pause, position de la vidéo et réactions (pour le calage) ; statistiques anonymes avec accord |
| Historique web | Non | Seul le site regardé (domaine) est utilisé, jamais la liste des pages visitées |
| Contenu des sites web | Non | La vidéo n'est ni lue ni copiée |
| Santé, finances, authentification, localisation | Non | — |

Cocher les 3 engagements : pas de vente à des tiers, pas d'usage sans rapport avec l'objectif unique, pas d'usage pour évaluer un crédit.
**Politique de confidentialité** : https://salon-coche-private.onrender.com/confidentialite

## 5. Images (dans `store-images.zip`)
- `icone-store-128.png` : icône 128 × 128, dessin de 96 px avec une marge transparente, comme Google le recommande.
- 4 captures 1280 × 800 : `2-anime.png` (spoil flouté + PEAK), `3-paddock.png` (feux de départ + radio), `1-choix.png` (7 ambiances), `4-vestiaire.png` (réactions sur la vidéo). Prénoms du calendrier romain, décor neutre, aucune image d'un vrai programme ni aucun logo.
- `vignette-440x280.png` : petite vignette. Elle est facultative, mais les extensions qui en ont une sont mieux placées.

## 6. À savoir
- Le paquet est fabriqué par `make-store-zip.sh` : `manifest.json` est à la racine du zip, les adresses `localhost` (qui ne servent qu'aux tests) sont retirées, et la description est à jour. Le code est identique à la 0.9.3 en ligne. Le paquet a été vérifié dans Chromium : il se charge sans erreur.
- Pour chaque nouvelle version : monter le numéro, relancer `make-store-zip.sh` et envoyer le zip dans la console. Les mises à jour passent aussi par l'examen.
- Les personnes qui ont installé le zip à la main ne seront pas mises à jour par le store : il faudra leur envoyer le lien du store une fois.
- L'icône actuelle a un rond rouge-orangé. C'est à revoir avec Design si la règle des couleurs (pas d'orange, pas de rouge vif) doit aussi s'appliquer à l'icône.
