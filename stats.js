// Statistiques de session (phase de test) — anonymes, envoyées après chaque séance aux data analysts.
// Ce qui est noté : site regardé (domaine seulement), durée, nombre de participants, mode, ambiance, nombre de réactions,
// de messages, de BUUUTS, chaque calage (écart, réussi ou non), coupures / reconnexions, soucis techniques signalés.
// Ce qui n'est JAMAIS noté : texte des messages, voix, pseudos, adresses des pages, code du salon.
// Chaque navigateur est représenté par un identifiant au hasard (empreinte de son identifiant Cowatch) : on suit l'usage
// d'une séance à l'autre sans savoir qui c'est. Les détails d'un participant ne partent que s'il a donné son accord.
// Envoi : POST JSON vers un script Google (Apps Script, voir stats-google-script.gs) qui envoie les CSV par e-mail.
'use strict';
const crypto = require('crypto');

const URL_ = process.env.TELEMETRY_URL || '';
const KEY = process.env.TELEMETRY_KEY || 'cowatch-stats-2026';
const SALT = process.env.TELEMETRY_SALT || 'cowatch-anonyme';
const GRACE = +(process.env.TELEMETRY_GRACE_MS || 90000); // salon vide depuis 90 s = séance terminée
const sessions = new Map(); // code du salon -> séance en cours
let lastSent = null;        // dernier envoi (tests et /stats)

const anonOf = cid => cid ? crypto.createHash('sha256').update(SALT + cid).digest('hex').slice(0, 12) : 'web-' + crypto.randomBytes(3).toString('hex');
const clean = (v, n = 40) => String(v ?? '').replace(/[\r\n,;"]/g, ' ').slice(0, n);

function sess(room) {
  let s = sessions.get(room);
  if (!s) {
    s = { id: crypto.randomBytes(5).toString('hex'), start: Date.now(), end: null, theme: '', modes: new Set(), people: new Map(),
      peakSalon: 0, peakPlayers: 0, n: { reactions: 0, messages: 0, buts: 0, var: 0, pronos: 0, recaps: 0, calages: 0, calagesBloques: 0, reconnexions: 0, themes: 0 },
      maxEcart: 0, events: [], timer: null, owner: '', multiSince: 0, multiMs: 0, lastLeave: 0, rpm: new Map() };
    sessions.set(room, s);
  }
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  return s;
}
const ev = (s, type, detail = '', who = '') => { if (s.events.length < 400) s.events.push({ t: Date.now(), type, who, detail: clean(detail, 80) }); };

// ---------- Points d'accroche appelés par server.js ----------
function onJoin(room, me, info) {
  const s = sess(room), a = me.anon || (me.anon = anonOf(me.cid));
  let p = s.people.get(a);
  if (!p) { p = { anon: a, salon: false, video: false, web: !me.cid, first: Date.now(), last: Date.now(), joins: 0, consent: null, client: null }; s.people.set(a, p); }
  if (me.kind === 'salon') p.salon = true; else p.video = true;
  p.joins++; p.last = Date.now();
  if (info.owner && !s.owner) s.owner = a;
  if (me.kind === 'salon' && info.salons >= 2 && !s.multiSince) s.multiSince = Date.now(); // début du temps passé à 2 ou plus
  if (info.replaced) { s.n.reconnexions++; ev(s, 'reconnexion', me.kind, a); } else ev(s, 'arrivee', me.kind === 'player' ? 'video reliee' : 'panneau', a);
  if (info.theme) s.theme = info.theme;
  if (info.mode) s.modes.add(info.mode);
  s.peakSalon = Math.max(s.peakSalon, info.salons); s.peakPlayers = Math.max(s.peakPlayers, info.players);
}
function onLeave(room, me, empty, salons = 0) {
  const s = sessions.get(room); if (!s) return;
  const p = s.people.get(me.anon); if (p) p.last = Date.now();
  if (me.kind === 'salon') s.lastLeave = Date.now();
  if (me.kind === 'salon' && salons < 2 && s.multiSince) { s.multiMs += Date.now() - s.multiSince; s.multiSince = 0; }
  ev(s, 'depart', me.kind, me.anon || '');
  if (empty) { s.end = s.lastLeave || Date.now(); s.timer = setTimeout(() => finish(room), GRACE); s.timer.unref?.(); }
}
function count(room, what, n = 1) {
  const s = sessions.get(room); if (!s || !(what in s.n)) return;
  s.n[what] += n;
  if (what === 'reactions') { const k = Math.floor((Date.now() - s.start) / 60000); s.rpm.set(k, (s.rpm.get(k) || 0) + n); }
}
function event(room, type, detail, me) { const s = sessions.get(room); if (s) ev(s, type, detail, me?.anon || ''); }
function mode(room, m, who = '', how = '') { const s = sessions.get(room); if (s) { s.modes.add(m); ev(s, 'mode', how ? `${m} (${how})` : m, who); } }
function theme(room, t) { const s = sessions.get(room); if (s) { s.theme = t; s.n.themes++; ev(s, 'ambiance', t); } }
function calage(room, reason, spread, items, anonByName) {
  const s = sessions.get(room); if (!s) return;
  s.n.calages++; s.maxEcart = Math.max(s.maxEcart, Math.abs(spread));
  ev(s, 'calage', `${reason} ecart ${(+spread).toFixed(2)} s ` + items.map(i => `${anonByName(i.name) || '?'}:${(+i.ahead).toFixed(2)}`).join(' '));
}
// Rapport envoyé par l'extension de chaque participant (seulement s'il a donné son accord).
function client(room, me, m) {
  const s = sessions.get(room); if (!s) return;
  const p = s.people.get(me.anon); if (!p) return;
  p.consent = m.consent === true;
  if (!p.consent) { p.client = null; return; }
  const issues = {};
  for (const [k, n] of Object.entries(m.issues || {}).slice(0, 20)) issues[clean(k, 30)] = Math.min(+n || 0, 999);
  p.client = { site: clean(String(m.site || '').replace(/^www\./, ''), 40), version: clean(m.version, 12), navigateur: clean(m.browser, 20), systeme: clean(m.os, 20),
    micro: clean(m.mic, 20), heureReelle: m.realClock === true ? 'oui' : m.realClock === false ? 'non' : '', issues };
}

// ---------- Fin de séance : envoi ----------
async function finish(room) {
  const s = sessions.get(room); if (!s) return; sessions.delete(room);
  const dur = Math.round(((s.end || Date.now()) - s.start) / 1000);
  const people = [...s.people.values()];
  const payload = {
    key: KEY,
    session: { id: s.id, debut: new Date(s.start).toISOString(), fin: new Date(s.end || Date.now()).toISOString(), duree_s: dur,
      participants: people.filter(p => p.salon).length, avec_video: people.filter(p => p.video).length, web_sans_extension: people.filter(p => p.web).length,
      max_simultanes: s.peakSalon, duree_a_plusieurs_s: Math.round((s.multiMs + (s.multiSince ? (s.end || Date.now()) - s.multiSince : 0)) / 1000),
      createur: s.owner, modes: [...s.modes].join('+'), ambiance: s.theme,
      reactions_par_minute: [...s.rpm.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join(' '),
      sites: [...new Set(people.map(p => p.client?.site).filter(Boolean))].join('+'),
      ...s.n, ecart_max_s: +s.maxEcart.toFixed(2), accords: people.filter(p => p.consent).length },
    participants: people.map(p => p.consent ? {
      id: p.anon, panneau: p.salon ? 1 : 0, video: p.video ? 1 : 0, arrivee: new Date(p.first).toISOString(), depart: new Date(p.last).toISOString(),
      connexions: p.joins, ...p.client, soucis: Object.entries(p.client?.issues || {}).map(([k, n]) => `${k}x${n}`).join(' ') , issues: undefined
    } : { id: p.anon, accord: 0, panneau: p.salon ? 1 : 0, video: p.video ? 1 : 0 }),
    evenements: s.events.map(e => ({ heure: new Date(e.t).toISOString(), type: e.type, qui: e.who, detail: e.detail })),
  };
  for (const p of payload.participants) delete p.issues;
  if (dur < 20 && people.length < 2) return; // ouverture éclair sans personne : rien à analyser
  lastSent = payload;
  if (!URL_) return;
  try { await fetch(URL_, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' }); }
  catch (e) { console.error('stats : envoi impossible', e.message); }
}
// Arrêt du serveur (mise à jour) : on envoie les séances en cours.
function flushAll() { return Promise.all([...sessions.keys()].map(finish)); }

module.exports = { onJoin, onLeave, count, event, mode, theme, calage, client, finish, flushAll, last: () => lastSent, enabled: () => !!URL_ };
