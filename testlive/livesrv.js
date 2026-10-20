// Faux direct HLS pour les tests (port 8095). Lancement seul : node testlive/livesrv.js
const path = require('path'), fs = require('fs'), http = require('http'), { execSync } = require('child_process');
const LIVE = 'http://localhost:8095', DIR = __dirname;
// Morceaux vidéo de test (générés une fois avec ffmpeg, pas stockés dans le dépôt).
if (!fs.existsSync(path.join(DIR, 'seg', 's150.m4s'))) {
  fs.mkdirSync(path.join(DIR, 'seg'), { recursive: true });
  execSync(`ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=192x108:rate=25" -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 300 -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 120k -g 50 -keyint_min 50 -c:a libopus -b:a 48k -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 -hls_segment_filename '${DIR}/seg/s%03d.m4s' ${DIR}/seg/vod.m3u8`);
}

// ---------- Faux direct ----------
const T0 = Date.now() + 1000;     // le morceau n est disponible à T0 + (n+1)*2 s
const ENC = 2500;                  // l'image du morceau n a été filmée à T0 - ENC + n*2 s (retard d'encodage)
const SSAI_SHIFT = 400;            // 2e liste (pl=ssai) : temps vidéo décalé de 400 s comme sur TF1 (pubs insérées)
const live = http.createServer((req, res) => {
  const u = new URL(req.url, LIVE); res.setHeader('access-control-allow-origin', '*');
  if (u.pathname === '/live.m3u8') {
    const last = Math.min(149, Math.floor((Date.now() - T0) / 2000) - 1);
    const first = Math.max(0, last - 7);
    let m = `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${first}\n#EXT-X-MAP:URI="seg/init.mp4"\n`;
    for (let n = first; n <= last; n++) m += `#EXT-X-PROGRAM-DATE-TIME:${new Date(T0 - ENC + n * 2000).toISOString()}\n#EXTINF:2.000,\nseg/s${String(n).padStart(3, '0')}.m4s\n`;
    res.setHeader('content-type', 'application/vnd.apple.mpegurl'); res.setHeader('cache-control', 'no-store'); return res.end(m);
  }
  const f = path.join(DIR, u.pathname === '/hls.min.js' ? 'hls.min.js' : u.pathname === '/player.html' ? 'player.html' : u.pathname.slice(1));
  if (!f.startsWith(DIR) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'video/mp4');
  fs.createReadStream(f).pipe(res);
}).listen(8095);
module.exports = { live, T0, ENC };

