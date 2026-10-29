#!/bin/bash
# Fabrique cowatch.zip (téléchargé depuis /installer) : un dossier « Cowatch » avec les fichiers de l'extension.
# À relancer avant chaque mise en ligne qui touche l'extension.
cd "$(dirname "$0")"
T=$(mktemp -d); mkdir "$T/Cowatch"
cp -r background.js coeur engine.html engine.js fonts icons join.js manifest.json mic.html mic.js panel.html "$T/Cowatch/"
rm -f cowatch.zip; (cd "$T" && zip -qrX "$OLDPWD/cowatch.zip" Cowatch); rm -rf "$T"
echo "cowatch.zip : $(du -h cowatch.zip | cut -f1)"
