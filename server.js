// Serveur de salons — signalisation WebRTC (voix), relais de synchro lecteur, réactions.
// Zéro dépendance : HTTP statique + WebSocket (RFC 6455) implémenté à la main.
// Lancement : node server.js   (PORT=8080 par défaut)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
// Pages web : dans ../web (dépôt structuré) ou à côté de server.js (fichiers envoyés en vrac sur GitHub).
const STRUCTURED = fs.existsSync(path.join(__dirname, '..', 'web', 'index.html'));
const WEB_DIR = STRUCTURED ? path.join(__dirname, '..', 'web') : __dirname;
// En mode "vrac", on ne sert QUE les fichiers publics (pas le code du serveur ni de l'extension).
const PUBLIC_FILES = new Set(['/index.html', '/join.html', '/test-player.html', '/test.webm', '/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/installer.html', '/cowatch.zip', '/sondage-anime.html', '/sondage-telerealite.html']);

// ---------- Sondages ----------
// Les réponses partent dans le Google Sheet de Lucas (script Apps Script « Cowatch sondages »).
// Adresse du script : variable SONDAGE_SHEET_URL sur l'hébergeur, sinon la constante ci-dessous.
const SONDAGE_SHEET_URL = process.env.SONDAGE_SHEET_URL || '';
const SONDAGE_CLE = 'cowatch-sondage-2026';
const SONDAGE_PAGES = { '/sondage/anime': '/sondage-anime.html', '/sondage/telerealite': '/sondage-telerealite.html', '/sondage/tele': '/sondage-telerealite.html' };
const sondageParIp = new Map(); // garde-fou anti-spam : 20 envois par heure et par adresse
function sondageAutorise(ip) {
  const now = Date.now(), h = (sondageParIp.get(ip) || []).filter(t => now - t < 3600e3);
  if (h.length >= 20) return false;
  h.push(now); sondageParIp.set(ip, h); return true;
}
function nettoieSondage(d) {
  if (!d || (d.track !== 'anime' && d.track !== 'tele') || typeof d.answers !== 'object' || !d.answers) return null;
  const answers = {};
  for (const [k, v] of Object.entries(d.answers).slice(0, 30)) {
    if (!/^[a-z_]{1,30}$/.test(k)) continue;
    if (Array.isArray(v)) answers[k] = v.slice(0, 15).map(x => String(x).slice(0, 40));
    else if (v != null) answers[k] = String(v).slice(0, k === 'email' ? 120 : 40);
  }
  return { track: d.track, v: Number(d.v) || 1, duree_s: Math.max(0, Math.min(3600, Number(d.duree_s) || 0)), answers };
}
function recoitSondage(req, res) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  let body = '';
  req.on('data', c => { body += c; if (body.length > 20000) req.destroy(); });
  req.on('end', async () => {
    let d = null; try { d = nettoieSondage(JSON.parse(body)); } catch (e) {}
    if (!d) { res.statusCode = 400; res.end('{"ok":false}'); return; }
    if (!sondageAutorise(ip)) { res.statusCode = 429; res.end('{"ok":false}'); return; }
    d.date = new Date().toISOString();
    console.log('SONDAGE ' + JSON.stringify(d)); // copie de secours dans les journaux Render
    if (!SONDAGE_SHEET_URL) { res.setHeader('content-type', 'application/json'); res.end('{"ok":true,"sheet":false}'); return; }
    try {
      const r = await fetch(SONDAGE_SHEET_URL, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ cle: SONDAGE_CLE, ...d }), redirect: 'follow' });
      const txt = await r.text();
      const ok = r.ok && /"ok"\s*:\s*true/.test(txt);
      if (!ok) console.log('SONDAGE ERREUR SHEET ' + r.status + ' ' + txt.slice(0, 200));
      res.statusCode = ok ? 200 : 502; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok }));
    } catch (e) {
      console.log('SONDAGE ERREUR SHEET ' + e.message);
      res.statusCode = 502; res.end('{"ok":false}');
    }
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.zip': 'application/zip' };

// ---------- HTTP statique ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.end('ok'); return; }
  if (url.pathname === '/ice') { // serveurs pour la voix : STUN toujours, relais TURN si configuré (indispensable en 4G)
    iceServers().then(ice => {
      res.setHeader('content-type', 'application/json'); res.setHeader('access-control-allow-origin', '*');
      res.end(JSON.stringify({ iceServers: ice }));
    });
    return;
  }
  if (url.pathname === '/stats') { // compteur minimal pour le test (aucune donnée perso)
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ rooms: rooms.size, clients: [...rooms.values()].reduce((n, r) => n + r.size, 0), totals: stats }));
    return;
  }
  if (url.pathname === '/api/sondage' && req.method === 'POST') { recoitSondage(req, res); return; }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (SONDAGE_PAGES[p.replace(/\/$/, '')]) p = SONDAGE_PAGES[p.replace(/\/$/, '')];
  if (/^\/s\/[A-Za-z0-9-]+$/.test(p)) p = '/index.html'; // salon web sans extension /s/CODE
  if (/^\/j\/[A-Za-z0-9-]+$/.test(p)) p = '/join.html';
  if (p === '/installer' || p === '/installer/') p = '/installer.html'; // page d'installation à envoyer aux potes  // invitation /j/CODE?u=<page de la plateforme>
  if (!STRUCTURED && !PUBLIC_FILES.has(p)) { res.statusCode = 404; res.end('404'); return; }
  const file = path.normalize(path.join(WEB_DIR, p));
  if (!file.startsWith(WEB_DIR)) { res.statusCode = 403; res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.statusCode = 404; res.end('404'); return; }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const range = req.headers.range; // nécessaire pour la vidéo de test
    if (range && type.startsWith('video/')) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = parseInt(s, 10), end = e ? parseInt(e, 10) : st.size - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': type });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    }
  });
});

// ---------- Relais audio TURN ----------
// Cloudflare Realtime (1 000 Go/mois gratuits) : variables CF_TURN_KEY_ID et CF_TURN_API_TOKEN sur l'hébergeur.
// Identifiants temporaires (24 h) mis en cache 12 h. Sinon : TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL, sinon STUN seul.
let iceCache = null;
async function iceServers() {
  const stun = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) {
    if (iceCache && iceCache.until > Date.now()) return iceCache.ice;
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 })
      });
      const j = await r.json();
      if (Array.isArray(j.iceServers) && j.iceServers.length) { iceCache = { ice: j.iceServers, until: Date.now() + 12 * 3600 * 1000 }; return j.iceServers; }
      console.error('TURN Cloudflare : réponse inattendue', r.status);
    } catch (e) { console.error('TURN Cloudflare indisponible', e.message); }
  }
  if (process.env.TURN_URLS) return [...stun, { urls: process.env.TURN_URLS.split(',').map(u => u.trim()), username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' }];
  return stun;
}

// ---------- WebSocket minimal ----------
function encodeFrame(str, opcode = 0x1) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

class Conn {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frag = [];
    this.alive = true; this.onmessage = () => {}; this.onclose = () => {};
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }
  parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) return this.close(); // 1 Mo max
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const m = this.buf.subarray(off, off + 4); payload = Buffer.from(payload.map((x, i) => x ^ m[i % 4])); }
      this.buf = this.buf.subarray(need);
      if (op === 0x8) return this.close();
      if (op === 0x9) { this.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 0xa) { this.alive = true; continue; }
      if (op === 0x1 || op === 0x0) {
        this.frag.push(payload);
        if (fin) { const msg = Buffer.concat(this.frag).toString(); this.frag = []; this.onmessage(msg); }
      }
    }
  }
  send(obj) { if (!this.closed) try { this.socket.write(encodeFrame(JSON.stringify(obj))); } catch {} }
  ping() { if (!this.closed) try { this.socket.write(Buffer.from([0x89, 0])); } catch {} }
  close() { if (this.closed) return; this.closed = true; try { this.socket.end(Buffer.from([0x88, 0])); } catch {} this.onclose(); }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  handle(new Conn(socket));
});

// ---------- Logique des salons ----------
// room -> Map(id -> {conn, id, name, kind:'salon'|'player'})
const rooms = new Map();
// Métadonnées par salon : mode 'vod' (série : lecture partagée) ou 'live' (match : alignement sur le plus lent).
const meta = new Map(); // room -> {mode, calib:{id,label,tops:Map(name->serverTime)}}
const stats = { roomsCreated: 0, joins: 0, reactions: 0, syncEvents: 0, calibrations: 0, alignments: 0, autoSyncs: 0 };
const metaOf = room => { if (!meta.has(room)) meta.set(room, { mode: 'vod', calib: null, chat: [], theme: 'vestiaire', owner: '', pronos: new Map(), goal: null, moments: new Map(), goals: [], nReact: 0, nChat: 0, start: Date.now(), recap: null }); return meta.get(room); };
// Récap de fin de match : les réactions sont comptées par minute de la vidéo (heure réelle de l'image en direct, temps de la vidéo sinon).
function countMoment(md, emoji, at) {
  md.nReact++;
  if (at.pos == null) return;
  const key = `${at.kind}:${Math.floor(at.pos / 60)}`;
  let b = md.moments.get(key); if (!b) { if (md.moments.size >= 600) return; b = { kind: at.kind, pos: Math.floor(at.pos / 60) * 60, n: 0, emo: {} }; md.moments.set(key, b); }
  b.n++; b.emo[emoji] = (b.emo[emoji] || 0) + 1;
}
const outcome = sc => { const [h, a] = sc.split('-').map(Number); return Math.sign(h - a); };
function buildRecap(md, score) {
  const pronos = [...md.pronos.entries()].map(([name, p]) => ({ name, score: p, res: !score ? null : p === score ? 'exact' : outcome(p) === outcome(score) ? 'bon' : 'rate' }));
  const order = { exact: 0, bon: 1, rate: 2 }; pronos.sort((x, y) => (order[x.res] ?? 3) - (order[y.res] ?? 3));
  const moments = [...md.moments.values()].filter(b => b.n >= 3).sort((x, y) => y.n - x.n).slice(0, 3)
    .map(b => ({ kind: b.kind, pos: b.pos, n: b.n, emoji: Object.entries(b.emo).sort((x, y) => y[1] - x[1])[0][0] }))
    .sort((x, y) => x.pos - y.pos);
  return { t: 'recap', score: score || null, pronos, moments, buts: md.goals.filter(g => !g.cancelled).map(g => ({ by: g.by, ...g.where })),
    reactions: md.nReact, messages: md.nChat, duree: Math.round((Date.now() - md.start) / 60000), at: Date.now() };
}
// Ambiances (voir themes.js) : choisie par celui qui crée le salon, la même pour tous, modifiable par lui seul.
const THEMES = new Set(['vestiaire', 'salle', 'canape', 'live', 'arene']);
const pronosOf = room => [...metaOf(room).pronos.entries()].map(([name, score]) => ({ name, score }));
const PRONO_RE = /^\d{1,2}-\d{1,2}$/;
// Position de la vidéo jointe aux réactions et au BUUUT : chacun l'affiche quand ce moment arrive dans SA vidéo (zéro spoil).
const cleanPos = m => (Number.isFinite(+m.pos) && (m.kind === 'real' || m.kind === 'media')) ? { pos: +(+m.pos).toFixed(3), kind: m.kind } : {};
const CHAT_HISTORY = 50; // derniers messages renvoyés à qui arrive en cours de route (en mémoire seulement, rien n'est stocké)

// Calibration "TOP" : chacun appuie quand il VOIT le même moment (coup de sifflet, changement du score à l'écran).
// Celui qui appuie le plus tard est le plus en retard = la référence. Les autres ont "advance" secondes d'avance.
function calibResult(room) {
  const c = metaOf(room).calib; if (!c || c.tops.size === 0) return null;
  const slowest = Math.max(...c.tops.values());
  const items = [...c.tops.entries()].map(([name, t]) => ({ name, advance: Math.round((slowest - t) / 100) / 10 }))
    .sort((a, b) => b.advance - a.advance);
  return { t: 'calib-result', id: c.id, label: c.label, items };
}
const ROOM_MAX = 8; // mesh WebRTC : au-delà, il faut un SFU (voir doc technique)

function peersOf(room) { return [...(rooms.get(room) || new Map()).values()]; }
function pub(c) { const p = { id: c.id, name: c.name, kind: c.kind }; if (c.avatar) p.avatar = c.avatar; if (c.muted) p.muted = true; return p; }
// Photo de profil : petite image (≤ 24 Ko) gardée en mémoire le temps du salon, jamais écrite sur disque.
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const cleanAvatar = a => (typeof a === 'string' && a.length <= 24000 && AVATAR_RE.test(a)) ? a : null;
function broadcast(room, msg, exceptId, kind) {
  for (const c of peersOf(room)) if (c.id !== exceptId && (!kind || c.kind === kind)) c.conn.send(msg);
}
// ---------- Calage automatique du direct ----------
// Chaque lecteur envoie sa position (= heure réelle de l'image affichée). L = heure serveur − position = son retard.
// Le plus en retard sert de référence ; chacun des autres se met en pause de son avance. À chaque arrivée, et si ça dérive.
// Lecteurs qui « reviennent tout seuls au direct » (ils refusent d'avoir plus de retard) : on les repère,
// et c'est alors aux autres d'avancer jusqu'à eux au lieu qu'eux se mettent en pause.
// Petits écarts (≤ 3 s) : le lecteur en avance ralentit légèrement (0,75×) au lieu de figer l'image.
const holdFor = sec => (sec > 0 && sec <= 3 ? sec / 0.25 : Math.abs(sec)) * 1000 + 4000;
function autoSync(room) {
  const md = metaOf(room); if (md.mode !== 'live') return;
  const now = Date.now();
  if (md.syncUntil && now < md.syncUntil) return; // des lecteurs sont en train de se caler
  const reason = md.syncAgain ? 'arrival' : 'drift', who = md.syncWho || null;
  const ps = peersOf(room).filter(c => c.kind === 'player' && c.clock && now - c.clock.at < 8000);
  if (ps.length < 2) return;
  // Après un calage : on attend une position envoyée APRÈS la fin du calage, sinon on recalerait sur une info périmée.
  if (md.syncEnd && ps.some(c => c.clock.at < md.syncEnd + 500)) return;
  // Lecteur revenu tout seul au direct pendant le calage : il ne sait pas prendre de retard, ce sont les autres qui avancent.
  for (const c of ps) if (c.expectL != null && !c.noBack && c.clock.L < c.expectL - 1.5) { c.noBack = true; stats.noBack = (stats.noBack || 0) + 1; }
  const Ls = ps.map(c => c.clock.L).sort((a, b) => a - b), med = Ls[Ls.length >> 1];
  const ok = ps.filter(c => Math.abs(c.clock.L - med) < 120); // au-delà : pas le même programme
  if (ok.length < 2) return;
  const Lmax = Math.max(...ok.map(c => c.clock.L));
  const fixed = ok.filter(c => c.noBack);
  const target = fixed.length ? Math.min(Lmax, ...fixed.map(c => c.clock.L)) : Lmax; // retard visé pour tout le salon
  const items = ok.map(c => ({ name: c.name, ahead: +(target - c.clock.L).toFixed(2) }));
  const spread = Math.max(...items.map(i => Math.abs(i.ahead)));
  if (reason === 'drift' && spread < 1.5) return;
  md.syncAgain = null; md.syncWho = null;
  if (reason === 'drift') { // garde-fou : si ça ne tient vraiment pas, on ne boucle pas
    md.drifts = (md.drifts || []).filter(t => now - t < 120000); md.drifts.push(now);
    if (md.drifts.length > 4) { if (!md.stuckSent) { md.stuckSent = true; broadcast(room, { t: 'autosync-stuck' }, null, 'salon'); } return; }
  }
  let hold = 0;
  for (const it of items) if (Math.abs(it.ahead) > 0.3) {
    hold = Math.max(hold, holdFor(it.ahead));
    for (const c of peersOf(room)) if (c.name === it.name) {
      c.conn.send({ t: 'align', pauseFor: it.ahead, name: it.name, auto: true });
      if (c.kind === 'player' && c.clock) { c.expectL = c.clock.L + it.ahead; c.checkFrom = now + holdFor(it.ahead); }
    }
  }
  md.syncUntil = now + hold; md.syncEnd = md.syncUntil;
  stats.autoSyncs++;
  broadcast(room, { t: 'autosync', reason, who, items, spread: +spread.toFixed(2) }, null, 'salon');
}
setInterval(() => { for (const room of rooms.keys()) autoSync(room); }, 3000).unref?.();
// Le "pilote" de lecture = le premier lecteur arrivé dans le salon.
function hostOf(room) { return peersOf(room).find(c => c.kind === 'player'); }

function handle(conn) {
  let me = null;
  const hb = setInterval(() => { if (!conn.alive) return conn.close(); conn.alive = false; conn.ping(); }, 25000);
  conn.onclose = () => {
    clearInterval(hb);
    if (!me || me.replaced) return;
    const r = rooms.get(me.room); if (!r) return;
    r.delete(me.id);
    broadcast(me.room, { t: 'peer-left', id: me.id });
    if (me.kind === 'player') { const h = hostOf(me.room); if (h) broadcast(me.room, { t: 'host', id: h.id }, null, 'player'); }
    if (r.size === 0) { rooms.delete(me.room); meta.delete(me.room); }
  };
  conn.onmessage = raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !me) {
      const room = String(m.room || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
      if (!room) return conn.send({ t: 'error', msg: 'code de salon invalide' });
      if (!rooms.has(room)) { rooms.set(room, new Map()); stats.roomsCreated++; }
      const r = rooms.get(room);
      const kind = m.kind === 'player' ? 'player' : 'salon';
      // Même navigateur qui se reconnecte (double clic, coupure réseau) : on remplace l'ancienne connexion
      // au lieu d'ajouter un « Lucas 2 » fantôme qui reçoit et renvoie tout en double.
      const cid = typeof m.cid === 'string' ? m.cid.slice(0, 64) : '';
      if (cid) for (const old of [...r.values()]) if (old.cid === cid && old.kind === kind) {
        old.replaced = true; r.delete(old.id); broadcast(room, { t: 'peer-left', id: old.id }); old.conn.close();
        stats.replaced = (stats.replaced || 0) + 1; if (kind === 'player') m.swapped = true;
      }
      if (kind === 'salon' && [...r.values()].filter(c => c.kind === 'salon').length >= ROOM_MAX)
        return conn.send({ t: 'error', msg: `salon plein (${ROOM_MAX} max en prototype)` });
      let name = String(m.name || 'Invité').trim().slice(0, 24) || 'Invité';
      const taken = new Set([...r.values()].filter(c => c.kind === kind).map(c => c.name));
      if (taken.has(name)) { let i = 2; while (taken.has(`${name} ${i}`)) i++; name = `${name} ${i}`; }
      me = { conn, id: crypto.randomBytes(4).toString('hex'), name, kind, room, cid };
      if (kind === 'salon') { const av = cleanAvatar(m.avatar); if (av) me.avatar = av; }
      const others = peersOf(room).map(pub);
      const md = metaOf(room);
      // Le premier arrivé (côté salon) est le créateur : il fixe l'ambiance et pourra la changer.
      if (kind === 'salon' && !md.owner && ![...r.values()].some(c => c.kind === 'salon')) { md.owner = cid || 'x'; if (THEMES.has(m.theme)) md.theme = m.theme; }
      r.set(me.id, me); stats.joins++;
      const h = hostOf(room);
      conn.send({ t: 'welcome', id: me.id, name: me.name, room, peers: others, host: h ? h.id : null, serverTime: Date.now(), mode: md.mode,
        theme: md.theme, owner: !!cid && md.owner === cid, pronos: pronosOf(room) });
      if (kind === 'salon' && md.recap) conn.send(md.recap);
      const cr = calibResult(room); if (cr && kind === 'salon') conn.send(cr);
      if (kind === 'salon' && metaOf(room).chat.length) conn.send({ t: 'chat-history', items: metaOf(room).chat });
      broadcast(room, { t: 'peer-joined', peer: pub(me) }, me.id);
      if (m.swapped) { const nh = hostOf(room); if (nh) broadcast(room, { t: 'host', id: nh.id }, null, 'player'); }
      if (kind === 'player' && h && h.id !== me.id) h.conn.send({ t: 'state-request' }); // le nouveau se cale sur le pilote
      if (kind === 'player') { me.needSync = true; me.joinedAt = Date.now(); } // en direct : recalage du salon dès sa 1re position
      return;
    }
    if (!me) return;
    switch (m.t) {
      case 'clock': { // position du lecteur en direct (heure réelle de l'image) => calage automatique
        if (me.kind !== 'player') return;
        const pos = Number(m.pos);
        if (!(pos > 1e8) || m.paused) { me.clock = null; return; }
        // Retard de l'image (s) ; médiane des 3 derniers relevés pour ignorer un relevé isolé.
        const raw = Date.now() / 1000 - pos; me.Lhist = [...(me.Lhist || []).slice(-2), raw];
        me.clock = { L: [...me.Lhist].sort((a, b) => a - b)[me.Lhist.length >> 1], at: Date.now() };
        // Après un calage : s'il a perdu tout seul le retard qu'on lui a fait prendre, son lecteur revient au direct.
        if (me.checkFrom && Date.now() > me.checkFrom && me.expectL != null) {
          if (me.clock.L < me.expectL - 1.5 && !me.noBack) { me.noBack = true; stats.noBack = (stats.noBack || 0) + 1; }
          if (Date.now() > me.checkFrom + 60000) { me.checkFrom = null; me.expectL = null; }
        }
        if (me.expectL != null && !me.checkFrom) me.expectL = null;
        if (me.needSync) { me.needSync = false; const md = metaOf(me.room); md.syncAgain = 'arrival'; md.syncWho = me.name; autoSync(me.room); }
        return;
      }
      case 'avatar': { // changement de photo en cours de salon
        if (me.kind !== 'salon') return;
        const av = cleanAvatar(m.avatar); if (av) me.avatar = av; else delete me.avatar;
        broadcast(me.room, { t: 'avatar', id: me.id, avatar: me.avatar || null });
        return;
      }
      case 'signal': { // WebRTC offer/answer/ice relayé tel quel, uniquement entre membres du salon
        const target = rooms.get(me.room)?.get(m.to);
        if (target) target.conn.send({ t: 'signal', from: me.id, data: m.data });
        break;
      }
      case 'reaction': { // on peut en envoyer beaucoup (c'est le but), mais pas plus de 8 par seconde et par personne
        const now = Date.now(); me.rx = (me.rx || []).filter(t => now - t < 1000);
        if (me.rx.length >= 8) break; me.rx.push(now);
        stats.reactions++;
        const emoji = String(m.emoji).slice(0, 8), md = metaOf(me.room), at = cleanPos(m);
        // Vestiaire : le premier ⚽ déclenche le BUUUT. Un seul par but : les ⚽ des 20 s suivantes sont de simples réactions.
        if (md.theme === 'vestiaire' && emoji === '⚽' && (!md.goal || md.goal.cancelled || now - md.goal.at > 20000)) {
          md.goal = { id: crypto.randomBytes(3).toString('hex'), at: now, by: me.name };
          md.goals.push(md.goal); md.goal.where = at; countMoment(md, emoji, at);
          stats.goals = (stats.goals || 0) + 1;
          broadcast(me.room, { t: 'goal', id: md.goal.id, by: me.name, from: me.id, ...at });
          break;
        }
        countMoment(md, emoji, at);
        broadcast(me.room, { t: 'reaction', from: me.id, name: me.name, emoji, ...at });
        break;
      }
      case 'goal-cancel': { // VAR : but refusé (dans les 20 s)
        const md = metaOf(me.room);
        if (!md.goal || md.goal.id !== m.id || Date.now() - md.goal.at > 20000) break;
        broadcast(me.room, { t: 'goal-cancel', id: md.goal.id, by: me.name }); md.goal.cancelled = true;
        break;
      }
      case 'theme': { // changement d'ambiance : seulement par celui qui a créé le salon
        const md = metaOf(me.room);
        if (me.kind !== 'salon' || !me.cid || md.owner !== me.cid || !THEMES.has(m.theme)) break;
        md.theme = m.theme; broadcast(me.room, { t: 'theme', theme: md.theme, by: me.name });
        break;
      }
      case 'prono': { // prono d'avant-match (Vestiaire) : « 2-1 »
        if (me.kind !== 'salon') break;
        const md = metaOf(me.room), score = String(m.score || '').trim();
        if (score && !PRONO_RE.test(score)) break;
        if (score) md.pronos.set(me.name, score); else md.pronos.delete(me.name);
        broadcast(me.room, { t: 'pronos', items: pronosOf(me.room) });
        break;
      }
      case 'recap': { // fin du match : le créateur du salon (ou n'importe qui s'il est parti) donne le score final
        if (me.kind !== 'salon') break;
        const md = metaOf(me.room), r = rooms.get(me.room);
        const ownerHere = [...(r?.values() || [])].some(c => c.kind === 'salon' && c.cid && c.cid === md.owner);
        if (ownerHere && md.owner !== me.cid) break;
        const score = String(m.score || '').trim();
        if (score && !PRONO_RE.test(score)) break;
        md.recap = buildRecap(md, score); stats.recaps = (stats.recaps || 0) + 1;
        broadcast(me.room, md.recap);
        break;
      }
      case 'mute': { // micro coupé ou non : affiché en pastille sur l'avatar (plus de message dans le chat)
        if (me.kind !== 'salon') break;
        me.muted = !!m.muted; broadcast(me.room, { t: 'mute', id: me.id, muted: me.muted }, me.id);
        break;
      }
      case 'sync': // play / pause / seek / state — relayé aux autres lecteurs et aux salons (pour l'affichage)
        stats.syncEvents++;
        broadcast(me.room, { t: 'sync', from: me.id, name: me.name, action: m.action, time: +m.time || 0, playing: !!m.playing, rate: +m.rate || 1, sentAt: Date.now() }, me.id);
        break;
      case 'chat': { // chat écrit : relayé à tout le salon (salons + extensions pour l'affichage sur le lecteur)
        const text = String(m.text || '').trim().slice(0, 500);
        if (!text) break;
        const msg = { t: 'chat', name: me.name, text, at: Date.now() };
        const h = metaOf(me.room).chat; h.push(msg); if (h.length > CHAT_HISTORY) h.shift(); metaOf(me.room).nChat++;
        stats.chats = (stats.chats || 0) + 1;
        broadcast(me.room, msg);
        break;
      }
      case 'mode': { // bascule série <-> match, pour tout le salon
        const mode = m.mode === 'live' ? 'live' : 'vod';
        const md0 = metaOf(me.room); if (md0.mode !== mode && mode === 'live') { md0.syncAgain = 'arrival'; md0.syncWho = me.name; }
        md0.mode = mode;
        broadcast(me.room, { t: 'mode', mode, by: me.name });
        break;
      }
      case 'calib-start': {
        const md = metaOf(me.room);
        md.calib = { id: crypto.randomBytes(3).toString('hex'), label: String(m.label || 'le prochain coup de sifflet').slice(0, 80), tops: new Map() };
        stats.calibrations++;
        broadcast(me.room, { t: 'calib-start', id: md.calib.id, label: md.calib.label, by: me.name }, null, 'salon');
        break;
      }
      case 'top': {
        const c = metaOf(me.room).calib;
        if (!c || c.id !== m.id || me.kind !== 'salon') break;
        if (!c.tops.has(me.name)) c.tops.set(me.name, Date.now()); // un seul TOP par personne et par calibration
        broadcast(me.room, calibResult(me.room), null, 'salon');
        break;
      }
      case 'align': { // applique la dernière calibration : chaque personne en avance se met en pause "advance" secondes
        const res = calibResult(me.room); if (!res) break;
        stats.alignments++;
        for (const it of res.items) {
          if (it.advance < 0.3) continue;
          for (const c of peersOf(me.room)) if (c.name === it.name) c.conn.send({ t: 'align', pauseFor: it.advance, name: it.name });
        }
        broadcast(me.room, { t: 'aligned', id: res.id, by: me.name }, null, 'salon');
        break;
      }
      case 'ping':
        conn.send({ t: 'pong', c: m.c, s: Date.now() });
        break;
    }
  };
}

server.listen(PORT, () => console.log(`Salon server on http://localhost:${PORT}`));
