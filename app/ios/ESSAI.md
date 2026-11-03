# Essai de l'appli iPhone, site par site

À remplir par Lucas (seul pour la partie A, avec un ami pour la partie B). Une ligne par site. Réponses courtes : oui / non / note.
Ce que l'essai doit dire : **chaque service accepte-t-il de lire sa vidéo dans l'appli ?** (certains renvoient vers leur propre appli ou refusent les vidéos protégées — FairPlay — hors Safari ; non vérifié à ce jour).

## A. Seul, 5 min par site (Crunchyroll, ADN, Netflix, Canal+, puis Prime Video, YouTube)
Pour chaque site :
1. L'accueil Cowatch affiche le site ? On le touche : **le vrai site** s'ouvre, avec son adresse visible en haut ? (oui / non)
2. **Connexion** : la vraie page de connexion du service s'affiche, tu te connectes ? (oui / non / « ouvrez l'appli » affiché)
3. **Lecture** : un épisode (gratuit si possible) se lance ? image nette (HD / floue) ? son ? (oui / non / message d'erreur exact)
4. **Le site te renvoie-t-il** vers l'App Store ou son appli ? (oui / non)
5. **Plein écran** : la vidéo passe en plein écran ? Le salon reste-t-il accessible en sortant ? (oui / non)
6. **Pivoter** l'iPhone : le salon passe à droite, la vidéo continue ? (oui / non)
7. Fermer puis rouvrir l'appli : toujours connecté au service ? (oui / non)

## B. À deux, 10 min (un site qui a marché en A, l'ami sur l'extension Chrome ou un autre iPhone)
8. **Invitation** : le lien envoyé ouvre le salon chez l'ami ? (oui / non)
9. **Calage** : lecture, pause, avance de 30 s chez l'un → suivi chez l'autre ? écart à l'œil (< 1 s / 1-3 s / plus) ?
10. **Voix** : vous vous entendez ? Et quand l'écran de l'iPhone s'éteint ou que tu changes d'appli ? (oui / non)
11. **Réactions et chat** : visibles des deux côtés ? Sur la vidéo en plein écran ? (oui / non)
12. Ressenti en une phrase : « je l'utiliserais / pas » et pourquoi.

## Tableau à recopier dans le fil commun
| Site | Ouvre | Connexion | Lecture (netteté) | Renvoi appli | Plein écran | Calage | Voix |
|---|---|---|---|---|---|---|---|
| Crunchyroll | | | | | | | |
| ADN | | | | | | | |
| Netflix | | | | | | | |
| Canal+ | | | | | | | |
| Prime Video | | | | | | | |
| YouTube | | | | | | | |

Ensuite Ingé met `etat` à `ok` ou `refuse` pour chaque site dans `app/web/sites.json` et corrige ce qui peut l'être.
Rappel : avant toute publication (TestFlight, App Store), conditions de chaque service et règles d'Apple à faire vérifier.
