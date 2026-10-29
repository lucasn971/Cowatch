// Cowatch — l'appli native simulée pour les tests : même contrat que Pont.kt (Android) et Pont.swift (iPhone).
// Un « téléphone » = une page « salon » (notre écran) + une page « lecteur » (le site, avec lecteur.js injecté).
const fs = require('fs');

const LECTEUR_CALLS = new Set(['storage.get']);          // le lecteur (page d'un site tiers) n'a droit qu'à ça
const LECTEUR_KEYS = new Set(['pendingJoin']);          // … et ne lit que l'invitation en attente

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
  // ---------- envois vers les pages ----------
  async toFrame(frame, env) { try { await frame.evaluate(s => window.__coqueRecv && window.__coqueRecv(s), JSON.stringify(env)); } catch (e) {} }
  toSalon(env) { if (this.salonFrame) return this.toFrame(this.salonFrame, env); }
  idOf(frame) { if (!this.frameIds.has(frame)) this.frameIds.set(frame, this.nextFrame++); return this.frameIds.get(frame); }
  async tab() { let title = ''; try { title = await this.lecteur.title(); } catch (e) {} return { id: 1, windowId: 1, active: true, url: this.lecteur.url(), title, status: 'complete' }; }
  async tabEvent() { this.toSalon({ k: 'event', name: 'tab', data: await this.tab() }); }
  async setPanel(open) {
    this.panelOpen = open;
    for (const f of this.frames.values()) this.toFrame(f, { k: 'msg', msg: { t: 'panel', open } });
  }
  async storageChange(changes) {
    this.toSalon({ k: 'event', name: 'storage', data: changes });
    const pub = Object.fromEntries(Object.entries(changes).filter(([k]) => LECTEUR_KEYS.has(k)));
    if (Object.keys(pub).length) for (const f of this.frames.values()) this.toFrame(f, { k: 'event', name: 'storage', data: pub });
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
      const targets = env.frameId != null ? [this.frames.get(env.frameId)].filter(Boolean) : [...this.frames.values()];
      await this.toSalon({ k: 'count', id: env.id, n: targets.length });
      for (const f of targets) this.toFrame(f, { k: 'msg', id: env.id, msg: env.msg, sender: { id: 'cowatch-app' } });
      return;
    }
    if (env.k === 'reply') { const f = this.frames.get(env.frameId); if (f) this.toFrame(f, { k: 'reply', id: env.id, value: env.value, none: !!env.none }); return; }
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
module.exports = { Telephone };
