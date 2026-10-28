#!/bin/bash
# Fabrique cowatch-store.zip pour le Chrome Web Store : manifest.json à la racine du zip (exigé par le store),
# sans les adresses « localhost » qui ne servent qu'aux tests, et avec la description de la fiche.
# Le code est exactement celui de l'extension : seul le manifeste copié change.
cd "$(dirname "$0")"
T=$(mktemp -d)
cp -r background.js clock.js engine.html engine.js fonts icons join.js manifest.json mic.html mic.js panel.css panel.html panel.js player.js themes.js "$T/"
node -e '
const fs = require("fs"), f = process.argv[1], m = JSON.parse(fs.readFileSync(f, "utf8"));
const keep = a => a.filter(u => !/localhost/.test(u));
m.description = "Regardez Netflix, Prime Video, Canal+, TF1+ ou Disney+ ensemble à distance : voix, chat, réactions et vidéo calée pour tous.";
if (m.description.length > 132) throw new Error("description trop longue : " + m.description.length);
m.host_permissions = keep(m.host_permissions);
for (const c of m.content_scripts) c.matches = keep(c.matches);
for (const w of m.web_accessible_resources || []) w.matches = keep(w.matches);
if (JSON.stringify(m).includes("localhost")) throw new Error("localhost encore présent");
fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
' "$T/manifest.json" || { rm -rf "$T"; exit 1; }
rm -f cowatch-store.zip; (cd "$T" && zip -qrX "$OLDPWD/cowatch-store.zip" .); rm -rf "$T"
echo "cowatch-store.zip : $(du -h cowatch-store.zip | cut -f1), version $(unzip -p cowatch-store.zip manifest.json | grep '"version"' | tr -dc '0-9.')"
