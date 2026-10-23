#!/bin/bash
# Lance toute la suite de tests (serveur local sur 8080 requis : node server/server.js).
cd "$(dirname "$0")"
fail=0
for t in e2e-v3.js onglets.js lot5.js installer.js clic-ui.js maj.js ambiance.js fiabilite.js plein-ecran.js live.js live-dash.js live-snap.js diag.js faces.js autosync.js e2e-web.js robust.js mic-retry.js mobile.js layout.js load.js; do
  echo "=== $t"; rm -rf /tmp/claude-0/v3a /tmp/claude-0/v3b /tmp/claude-0/diag /tmp/claude-0/fa /tmp/claude-0/fb /tmp/claude-0/sa /tmp/claude-0/sb /tmp/claude-0/sc
  out=$(timeout 200 node "$t" 2>&1); echo "$out" | grep -E "PASS|FAIL|Error"
  echo "$out" | grep -q "FAIL\|Error" && fail=1
done
echo; [ $fail = 0 ] && echo "TOUT EST VERT" || echo "ÉCHECS À CORRIGER"
