// Cowatch — l'appli native simulée pour les tests : même contrat que Pont.kt (Android) et Pont.swift (iPhone).
// Un « téléphone » = une page « salon » (notre écran) + une page « lecteur » (le site, avec lecteur.js injecté).
const fs = require('fs');

const LECTEUR_CALLS = new Set(['storage.get']);          // le lecteur (page d'un site tiers) n'a droit qu'à ça
const LECTEUR_KEYS = new Set(['pendingJoin']);          // … et ne lit que l'invitation en attente
const PILOTE_CALLS = new Set(['storage.get', 'media.etat', 'media.play', 'media.pause', 'media.seek']); // mode A : notre page « pilote »
const PILOTE = 0; // numéro de cadre réservé à la page pilote (comme Pont.kt)

// L'appli officielle simulée (Netflix…) telle que la voit Android : un lecteur avec un état, qu'on peut lire et commander.
class AppliSimulee {
  constructor(app = 'com.netflix.mediaclient', nom = 'Netflix') { this.app = app; this.nom = nom; this.playing = false; this.pos = 0; this.at = Date.now(); this.duree = 1440; this.cmds = []; this.surChange = null; }
  position() { return this.playing ? this.pos + (Date.now() - this.at) / 1000 : this.pos; }
  etat() { return { ok: true, app: this.app, nom: this.nom, titre: 'Épisode 1', etat: this.playing ? 'playing' : 'paused', pos: this.position(), vitesse: 1, duree: this.duree, t: Date.now() }; }
  // Commandes reçues de Cowatch (MediaController.TransportControls), appliquées avec un léger retard comme une vraie appli.
  commande(fn, a) {
    this.cmds.push(fn === 'media.seek' ? `${fn} ${Math.round(a.ms / 1000)}` : fn);
    setTimeout(() => {
      const p = this.position();
      if (fn === 'media.play') { this.pos = p; this.playing = true; }
      if (fn === 'media.pause') { this.pos = p; this.playing = false; }
      if (fn === 'media.seek') this.pos = a.ms / 1000;
      this.at = Date.now(); this.surChange && this.surChange();
    }, 250);
  }
  // Ce que fait l'utilisateur directement dans l'appli officielle.
  utilisateur(action, t) { const p = this.position(); this.at = Date.now(); if (action === 'play') { this.pos = t ?? p; this.playing = true; } if (action === 'pause') { this.pos = p; this.playing = false; } if (action === 'seek') this.pos = t; this.surChange && this.surChange(); }
}

class Telephone {
  constructor(ctx, nom, { www, base }) {
    this.ctx = ctx; this.nom = nom; this.base = base;
    this.bundle = fs.readFileSync(`${www}/lecteur.js`, 'utf8').replace('__COQUE_BASE_VALEUR__', base);
    this.store = {}; this.frames = new Map(); this.frameIds = new Map(); this.nextFrame = 1;
    this.salonFrame = null; this.panelOpen = true; this.log = { clip: [], room: [], open: [], mic: 0, refused: [] };
  }
  async ouvrir(salonUrl) {
    this.lecteur = await this.ctx.newPage();
    await this.lecteur.exposeBinding('__coqueTestPost', ({ frame }, s) => this.fromLecteur(frame, s));
    await this.lecteur.addInitScript(this.bundle);
    this.lecteur.on('framenavigated', f => { if (f === this.lecteur.mainFrame()) { this.frames.clear(); this.frameIds = new Map(); this.tabEvent(); } });
    this.salon = await this.ctx.newPage();
    await this.salon.exposeBinding('__coqueTestPost', ({ frame }, s) => this.fromSalon(frame, s));
    this.salonUrl = salonUrl;
  }
  async chargerSalon() { await this.salon.goto(this.salonUrl); }
  // Mode A : la page pilote (cachée sur le téléphone) et l'appli officielle simulée.
  async ouvrirPilote(url, appli) {
    this.appli = appli; this.pilote = await this.ctx.newPage();
    await this.pilote.exposeBinding('__coqueTestPost', ({ frame }, s) => this.fromPilote(frame, s));
    appli.surChange = () => { if (this.piloteFrame) this.toFrame(this.piloteFrame, { k: 'event', name: 'media', data: appli.etat() }); };
    await this.pilote.goto(url);
  }
  cadres() { return [...this.frames.values(), ...(this.piloteFrame ? [this.piloteFrame] : [])]; }
  cadre(id) { return id === PILOTE ? this.piloteFrame : this.frames.get(id); }
  async fromPilote(frame, s) {
    let env; try { env = JSON.parse(s); } catch (e) { return; }
    if (frame !== this.pilote.mainFrame()) return;
    if (env.k === 'hello') { this.piloteFrame = frame; return; }
    if (env.k === 'bye') { this.piloteFrame = null; return; }
    if (env.k === 'msg' && env.dir === 'salon') return this.toSalon({ k: 'msg', id: env.id, msg: env.msg, sender: { frameId: PILOTE, url: String(env.url || ''), tab: await this.tab() } });
    if (env.k === 'reply') return this.toSalon({ k: 'reply', id: env.id, value: env.value, none: !!env.none });
    if (env.k === 'call') {
      if (!PILOTE_CALLS.has(env.fn)) { this.log.refused.push('pilote:' + env.fn); return this.toFrame(frame, { k: 'ret', id: env.id, error: 'refusé' }); }
      if (env.fn === 'storage.get') { const keys = (env.args.keys || []).filter(k => LECTEUR_KEYS.has(k)); return this.toFrame(frame, { k: 'ret', id: env.id, value: Object.fromEntries(keys.filter(k => k in this.store).map(k => [k, this.store[k]])) }); }
      if (env.fn === 'media.etat') return this.toFrame(frame, { k: 'ret', id: env.id, value: this.appli.etat() });
      this.appli.commande(env.fn, env.args || {});
      return this.toFrame(frame, { k: 'ret', id: env.id, value: { ok: true } });
    }
  }
  // ---------- envois vers les pages ----------
  async toFrame(frame, env) { try { await frame.evaluate(s => window.__coqueRecv && window.__coqueRecv(s), JSON.stringify(env)); } catch (e) {} }
  toSalon(env) { if (this.salonFrame) return this.toFrame(this.salonFrame, env); }
  idOf(frame) { if (!this.frameIds.has(frame)) this.frameIds.set(frame, this.nextFrame++); return this.frameIds.get(frame); }
  async tab() { let title = ''; try { title = await this.lecteur.title(); } catch (e) {} return { id: 1, windowId: 1, active: true, url: this.lecteur.url(), title, status: 'complete' }; }
  async tabEvent() { this.toSalon({ k: 'event', name: 'tab', data: await this.tab() }); }
  async setPanel(open) {
    this.panelOpen = open;
    for (const f of this.cadres()) this.toFrame(f, { k: 'msg', msg: { t: 'panel', open } });
  }
  async storageChange(changes) {
    this.toSalon({ k: 'event', name: 'storage', data: changes });
    const pub = Object.fromEntries(Object.entries(changes).filter(([k]) => LECTEUR_KEYS.has(k)));
    if (Object.keys(pub).length) for (const f of this.cadres()) this.toFrame(f, { k: 'event', name: 'storage', data: pub });
  }
  async storageSet(items) {
    const ch = {}; for (const [k, v] of Object.entries(items)) { ch[k] = { oldValue: this.store[k], newValue: v }; this.store[k] = v; }
    await this.storageChange(ch);
  }
  // ---------- messages du lecteur (tous les cadres de la page du site) ----------
  async fromLecteur(frame, s) {
    let env; try { env = JSON.parse(s); } catch (e) { return; }
    const fid = this.idOf(frame);
    if (env.k === 'hello') { this.frames.set(fid, frame); return; }
    if (env.k === 'bye') { this.frames.delete(fid); return; }
    if (!this.frames.has(fid)) this.frames.set(fid, frame);
    if (env.k === 'msg' && env.dir === 'salon') {
      return this.toSalon({ k: 'msg', id: env.id, msg: env.msg, sender: { frameId: fid, url: String(env.url || ''), tab: await this.tab() } });
    }
    if (env.k === 'reply') return this.toSalon({ k: 'reply', id: env.id, value: env.value, none: !!env.none });
    if (env.k === 'call') {
      if (!LECTEUR_CALLS.has(env.fn)) { this.log.refused.push(env.fn); return this.toFrame(frame, { k: 'ret', id: env.id, error: 'refusé' }); }
      const keys = (env.args.keys || []).filter(k => LECTEUR_KEYS.has(k));
      return this.toFrame(frame, { k: 'ret', id: env.id, value: Object.fromEntries(keys.filter(k => k in this.store).map(k => [k, this.store[k]])) });
    }
  }
  // ---------- messages du salon ----------
  async fromSalon(frame, s) {
    let env; try { env = JSON.parse(s); } catch (e) { return; }
    if (env.k === 'hello') { this.salonFrame = frame; return; }
    if (env.k === 'msg' && env.dir === 'lecteur') {
      const targets = env.frameId != null ? [this.cadre(env.frameId)].filter(Boolean) : this.cadres();
      await this.toSalon({ k: 'count', id: env.id, n: targets.length });
      for (const f of targets) this.toFrame(f, { k: 'msg', id: env.id, msg: env.msg, sender: { id: 'cowatch-app' } });
      return;
    }
    if (env.k === 'reply') { const f = this.cadre(env.frameId); if (f) this.toFrame(f, { k: 'reply', id: env.id, value: env.value, none: !!env.none }); return; }
    if (env.k === 'call') {
      const a = env.args || {}; let value = null;
      switch (env.fn) {
        case 'storage.get': { const keys = a.keys || Object.keys(this.store); value = Object.fromEntries(keys.filter(k => k in this.store).map(k => [k, this.store[k]])); break; }
        case 'storage.set': await this.storageSet(a.items || {}); break;
        case 'storage.remove': { const ch = {}; for (const k of a.keys || []) { if (k in this.store) { ch[k] = { oldValue: this.store[k] }; delete this.store[k]; } } await this.storageChange(ch); break; }
        case 'tab.get': value = await this.tab(); break;
        case 'panel.open': await this.setPanel(true); value = { ok: true }; break;
        case 'panel.state': value = { open: this.panelOpen }; break;
        case 'open': this.log.open.push(a.url); break;
        case 'clip': this.log.clip.push(a); value = { ok: true }; break;
        case 'mic.ask': this.log.mic++; value = { granted: true }; break;
        case 'mic.state': value = { state: 'granted' }; break;
        case 'room.state': this.log.room.push(a); break;
        default: return this.toSalon({ k: 'ret', id: env.id, error: 'inconnu' });
      }
      return this.toSalon({ k: 'ret', id: env.id, value });
    }
  }
}
module.exports = { Telephone, AppliSimulee };
