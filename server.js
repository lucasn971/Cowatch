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
const PUBLIC_FILES = new Set(['/index.html', '/join.html', '/test-player.html', '/test.webm']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.json': 'application/json' };

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
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (/^\/s\/[A-Za-z0-9-]+$/.test(p)) p = '/index.html'; // salon web sans extension /s/CODE
  if (/^\/j\/[A-Za-z0-9-]+$/.test(p)) p = '/join.html';  // invitation /j/CODE?u=<page de la plateforme>
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
const stats = { roomsCreated: 0, joins: 0, reactions: 0, syncEvents: 0, calibrations: 0, alignments: 0 };
const metaOf = room => { if (!meta.has(room)) meta.set(room, { mode: 'vod', calib: null, chat: [] }); return meta.get(room); };
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
function pub(c) { return { id: c.id, name: c.name, kind: c.kind }; }
function broadcast(room, msg, exceptId, kind) {
  for (const c of peersOf(room)) if (c.id !== exceptId && (!kind || c.kind === kind)) c.conn.send(msg);
}
// Le "pilote" de lecture = le premier lecteur arrivé dans le salon.
function hostOf(room) { return peersOf(room).find(c => c.kind === 'player'); }

function handle(conn) {
  let me = null;
  const hb = setInterval(() => { if (!conn.alive) return conn.close(); conn.alive = false; conn.ping(); }, 25000);
  conn.onclose = () => {
    clearInterval(hb);
    if (!me) return;
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
      if (kind === 'salon' && [...r.values()].filter(c => c.kind === 'salon').length >= ROOM_MAX)
        return conn.send({ t: 'error', msg: `salon plein (${ROOM_MAX} max en prototype)` });
      let name = String(m.name || 'Invité').trim().slice(0, 24) || 'Invité';
      const taken = new Set([...r.values()].filter(c => c.kind === kind).map(c => c.name));
      if (taken.has(name)) { let i = 2; while (taken.has(`${name} ${i}`)) i++; name = `${name} ${i}`; }
      me = { conn, id: crypto.randomBytes(4).toString('hex'), name, kind, room };
      const others = peersOf(room).map(pub);
      r.set(me.id, me); stats.joins++;
      const h = hostOf(room);
      conn.send({ t: 'welcome', id: me.id, name: me.name, room, peers: others, host: h ? h.id : null, serverTime: Date.now(), mode: metaOf(room).mode });
      const cr = calibResult(room); if (cr && kind === 'salon') conn.send(cr);
      if (kind === 'salon' && metaOf(room).chat.length) conn.send({ t: 'chat-history', items: metaOf(room).chat });
      broadcast(room, { t: 'peer-joined', peer: pub(me) }, me.id);
      if (kind === 'player' && h && h.id !== me.id) h.conn.send({ t: 'state-request' }); // le nouveau se cale sur le pilote
      return;
    }
    if (!me) return;
    switch (m.t) {
      case 'signal': { // WebRTC offer/answer/ice relayé tel quel, uniquement entre membres du salon
        const target = rooms.get(me.room)?.get(m.to);
        if (target) target.conn.send({ t: 'signal', from: me.id, data: m.data });
        break;
      }
      case 'reaction':
        stats.reactions++;
        broadcast(me.room, { t: 'reaction', from: me.id, name: me.name, emoji: String(m.emoji).slice(0, 8) });
        break;
      case 'sync': // play / pause / seek / state — relayé aux autres lecteurs et aux salons (pour l'affichage)
        stats.syncEvents++;
        broadcast(me.room, { t: 'sync', from: me.id, name: me.name, action: m.action, time: +m.time || 0, playing: !!m.playing, rate: +m.rate || 1, sentAt: Date.now() }, me.id);
        break;
      case 'chat': { // chat écrit : relayé à tout le salon (salons + extensions pour l'affichage sur le lecteur)
        const text = String(m.text || '').trim().slice(0, 500);
        if (!text) break;
        const msg = { t: 'chat', name: me.name, text, at: Date.now() };
        const h = metaOf(me.room).chat; h.push(msg); if (h.length > CHAT_HISTORY) h.shift();
        stats.chats = (stats.chats || 0) + 1;
        broadcast(me.room, msg);
        break;
      }
      case 'mode': { // bascule série <-> match, pour tout le salon
        const mode = m.mode === 'live' ? 'live' : 'vod';
        metaOf(me.room).mode = mode;
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
