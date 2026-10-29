#!/bin/bash
# Prépare la branche main (= ce qui est en ligne) à partir de prochaine-version, SANS les sondages
# (ils attendent l'adresse du Google Sheet de Lucas). À lancer seulement après la validation de Lucas.
# usage : ./release-main.sh "message du commit"
set -e
cd "$(dirname "$0")"
[ -n "$1" ] || { echo "message de commit manquant"; exit 1; }
git checkout -q prochaine-version
./make-zip.sh
git add cowatch.zip && { git diff --cached --quiet || git commit -qm "cowatch.zip à jour"; }
git diff --quiet || { echo "modifications non enregistrées sur prochaine-version"; exit 1; }
git checkout -q main && git pull -q --ff-only origin main 2>/dev/null || true
git checkout prochaine-version -- .
# fichiers déplacés ou supprimés sur prochaine-version (ex. lot 0 : cœur commun dans coeur/) : les retirer aussi de main
for f in $(git ls-files); do git cat-file -e "prochaine-version:$f" 2>/dev/null || git rm -q "$f"; done
git rm -q --cached sondage-anime.html sondage-telerealite.html sondage-google-sheet.gs sondage.js 2>/dev/null || true
rm -f sondage-anime.html sondage-telerealite.html sondage-google-sheet.gs sondage.js
python3 - <<'PY'
import re
s = open('server.js').read()
a = s.index('// ---------- Sondages ----------'); b = s.index('\n', s.index('function recoitSondage'))
b = s.index('\n}\n', b) + 3                       # fin de recoitSondage
s = s[:a] + s[b:]
s = s.replace(", '/sondage-anime.html', '/sondage-telerealite.html'", '')
s = '\n'.join(l for l in s.split('\n') if 'ondage' not in l.lower())
open('server.js', 'w').write(s)
PY
node --check server.js
git add -A && git commit -qm "$1" && git push -q origin main
git checkout -q prochaine-version
echo "main mis à jour : $(git log -1 --format=%h main)"
