#!/usr/bin/env bash
# Cowatch — assemble les pages web de l'appli (Android et iPhone) à partir du cœur commun.
# Usage : app/outils/assembler-web.sh <dossier de sortie>
# Rien n'est recopié à la main : le cœur (coeur/, engine.js, panel.html, fonts/) reste la seule source.
set -euo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
SORTIE="${1:?dossier de sortie}"
rm -rf "$SORTIE"; mkdir -p "$SORTIE/coeur" "$SORTIE/coque" "$SORTIE/fonts" "$SORTIE/icons"

cp "$RACINE"/coeur/{player.js,clock.js,themes.js,panel.js,panel.css} "$SORTIE/coeur/"
cp "$RACINE/engine.js" "$SORTIE/engine.js"
cp "$RACINE"/fonts/*.woff "$RACINE/fonts/OFL-Barlow.txt" "$SORTIE/fonts/"
cp "$RACINE"/icons/*.png "$SORTIE/icons/"
cp "$RACINE"/app/web/{coque.js,fond.js,app.js,app.css} "$SORTIE/coque/"
cp "$RACINE"/app/web/{accueil.html,accueil.js,accueil.css,sites.json} "$SORTIE/"

# Écran du salon = le panneau de l'extension + la coque chargée avant le cœur.
PANEL="$RACINE/panel.html"
grep -q '<script src="coeur/themes.js"></script>' "$PANEL" || { echo "panel.html a changé : balise themes.js introuvable" >&2; exit 1; }
grep -q '<link rel="stylesheet" href="coeur/panel.css">' "$PANEL" || { echo "panel.html a changé : balise panel.css introuvable" >&2; exit 1; }
sed -e 's#<script src="coeur/themes.js"></script>#<script src="coque/coque.js"></script><script src="coque/fond.js"></script><script src="coque/app.js"></script><script src="coeur/themes.js"></script>#' \
    -e 's#<link rel="stylesheet" href="coeur/panel.css">#<link rel="stylesheet" href="coeur/panel.css"><link rel="stylesheet" href="coque/app.css">#' \
    "$PANEL" > "$SORTIE/salon.html"

# Script injecté dans la page du service (et dans ses cadres) : coque « lecteur » + clock.js tout de suite,
# puis themes.js + player.js quand la page est prête (comme document_start / document_idle dans l'extension).
# Le tout dans une portée fermée : la page du site ne voit pas notre objet chrome. L'appli remplace __COQUE_BASE_VALEUR__.
{
  echo ';(function () {'
  echo 'if (window.__cowatchCoque) return; window.__cowatchCoque = true;'
  echo 'var __COQUE_LECTEUR__ = true, __COQUE_BASE__ = "__COQUE_BASE_VALEUR__";'
  cat "$RACINE/app/web/coque.js"
  echo 'var chrome = __creerCoque("lecteur");'
  echo 'try {'; cat "$RACINE/coeur/clock.js"; echo '} catch (e) { console.warn("cowatch clock", e); }'
  echo 'var __cowatchRun = function () {'
  echo 'try {'; cat "$RACINE/coeur/themes.js"; echo '} catch (e) { console.warn("cowatch themes", e); }'
  echo 'try {'; cat "$RACINE/coeur/player.js"; echo '} catch (e) { console.warn("cowatch player", e); }'
  echo '};'
  echo 'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", __cowatchRun, { once: true }); else __cowatchRun();'
  echo '})();'
} > "$SORTIE/lecteur.js"
if command -v node >/dev/null; then node --check "$SORTIE/lecteur.js"; node --check "$SORTIE/coque/coque.js"; fi
echo "Pages de l'appli assemblées dans $SORTIE"
