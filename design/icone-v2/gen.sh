#!/bin/bash
# Icône Cowatch v2 « A Brume » (choisie par Lucas le 04/11/2026, planche https://claude.ai/artifact/771fbamnnrDSjXMo5ZQKeV).
# Régénère les SVG sources puis tous les PNG (extension, site, appli). Besoin : rsvg-convert, convert (ImageMagick).
set -e
cd "$(dirname "$0")"
BG="#16231F"; DISC="#6CC4AC"; RING="#D7E6DF"; PLAY="#16231F"
motif() { # $1 disque $2 anneau $3 lecture $4 opacité anneau
  echo "<circle cx=\"206\" cy=\"256\" r=\"118\" fill=\"$1\"/><circle cx=\"306\" cy=\"256\" r=\"104\" fill=\"none\" stroke=\"$2\" stroke-width=\"28\" opacity=\"$4\"/><path d=\"M240 222 L240 290 L290 256 Z\" fill=\"$3\" stroke=\"$3\" stroke-width=\"6\" stroke-linejoin=\"round\"/>"
}
head='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
echo "$head<rect width=\"512\" height=\"512\" fill=\"$BG\"/>$(motif $DISC $RING $PLAY 0.9)</svg>" > carre.svg
echo "$head<clipPath id=\"c\"><circle cx=\"256\" cy=\"256\" r=\"256\"/></clipPath><g clip-path=\"url(#c)\"><rect width=\"512\" height=\"512\" fill=\"$BG\"/>$(motif $DISC $RING $PLAY 0.9)</g></svg>" > rond.svg
echo "$head<rect width=\"512\" height=\"512\" fill=\"#000000\"/>$(motif $DISC $RING '#000000' 0.9)</svg>" > iphone-sombre.svg
echo "$head<rect width=\"512\" height=\"512\" fill=\"#000000\"/>$(motif '#C8C8C8' '#8A8A8A' '#000000' 0.9)</svg>" > iphone-teintee.svg
R=../..
png() { rsvg-convert -w $2 -h $2 "$1" -o "$3"; }
# Extension Chrome : version ronde (comme l'ancienne icône)
for s in 16 32 48 128 192 512; do png rond.svg $s $R/icons/$s.png; done
# Fiche du Chrome Web Store : motif de 96 px dans un carré de 128 (marge transparente exigée par Google)
png rond.svg 96 /tmp/i96.png; convert /tmp/i96.png -background none -gravity center -extent 128x128 $R/store/images/icone-store-128.png
# Site (écran d'accueil, PWA « maskable ») : carré plein, le système arrondit lui-même
png carre.svg 192 $R/icon-192.png; png carre.svg 512 $R/icon-512.png; png carre.svg 180 $R/apple-touch-icon.png
# Appli (si présente sur la branche)
A=$R/app/android/app/src/main/res
if [ -d "$A" ]; then png rond.svg 144 $A/mipmap-xxhdpi/ic_launcher.png; png rond.svg 192 $A/mipmap-xxxhdpi/ic_launcher.png; fi
I=$R/app/ios/Cowatch/Assets.xcassets/AppIcon.appiconset
if [ -d "$I" ]; then
  for v in carre:AppIcon iphone-sombre:AppIcon-sombre iphone-teintee:AppIcon-teintee; do
    png ${v%%:*}.svg 1024 /tmp/x.png; convert /tmp/x.png -background "#000000" -alpha remove -alpha off $I/${v##*:}.png
  done
fi
echo ok
