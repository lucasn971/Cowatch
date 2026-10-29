// Cowatch — coque mobile (Android, iPhone) : remplace l'API chrome.* de l'extension.
// Le cœur (coeur/panel.js, coeur/player.js, engine.js) tourne tel quel ; seuls ces appels changent de route :
//
//   écran du salon (salon.html : panneau + moteur + fond)  ⇄  appli native  ⇄  lecteur (page du service, tous ses cadres)
//
// Deux rôles :
//  - « salon »   : notre page (origine de l'appli). chrome.runtime.sendMessage reste dans la page (panneau ↔ moteur ↔ fond),
//                  chrome.tabs.sendMessage part vers le lecteur.
//  - « lecteur » : injecté dans la page du service (Netflix, Crunchyroll…), dans une portée fermée : la page ne voit pas
//                  notre objet chrome. chrome.runtime.sendMessage part vers le salon.
// Le pont natif n'est ouvert qu'aux origines de la liste blanche (sites.json), et le lecteur n'y a droit qu'à quelques appels.
// Rien ici ne lit les champs de la page (identifiants, mot de passe) : on ne touche qu'à la balise <video>.
//
// Messages entre la page et l'appli (JSON, champ k) :
//   page → appli : hello {role,url} · msg {id,dir,msg,url,frameId?} · reply {id,value,none,frameId?} · call {id,fn,args}
//   appli → page : msg {id,msg,sender} · reply {id,value,none} · count {id,n} · ret {id,value,error} · event {name,data}
var __creerCoque = (function () {
  'use strict';
  return function creerCoque(role) {
    const LECTEUR = role === 'lecteur';
    const BASE = (typeof __COQUE_BASE__ !== 'undefined' && __COQUE_BASE__) || new URL('./', location.href).href;
    const APP_ID = 'cowatch-app';

    // ---------- Transport vers l'appli native ----------
    // Cherché à chaque envoi tant qu'il n'est pas trouvé : selon le téléphone, l'objet natif peut arriver juste après ce script.
    let post = null;
    function transport() {
      const N = self.CowatchNative; // Android : objet posé par WebViewCompat.addWebMessageListener (origines autorisées seulement)
      if (N && typeof N.postMessage === 'function') {
        const on = e => recv(e && e.data);
        if (typeof N.addEventListener === 'function') N.addEventListener('message', on); else N.onmessage = on;
        return s => N.postMessage(s);
      }
      const W = self.webkit && self.webkit.messageHandlers && self.webkit.messageHandlers.cowatch; // iPhone : WKScriptMessageHandler
      if (W) return s => W.postMessage(s);
      if (typeof self.__coqueTestPost === 'function') return s => self.__coqueTestPost(s); // tests (appli simulée)
      return null;
    }
    // iPhone et tests : l'appli appelle window.__coqueRecv("…"). Plusieurs coques dans la même page s'empilent.
    const prevRecv = self.__coqueRecv;
    const myRecv = s => { recv(s); if (typeof prevRecv === 'function') prevRecv(s); };
    self.__coqueRecv = myRecv;
    // Jeton du cadre : l'iPhone ne sait pas distinguer les cadres d'une page autrement (Android, si).
    const CADRE = Math.random().toString(36).slice(2, 12);
    const send = env => {
      if (!post) post = transport();
      if (!post) return false;
      try { post(JSON.stringify(LECTEUR ? { ...env, cadre: CADRE } : env)); return true; } catch (e) { return false; }
    };

    let seq = 0;
    const nextId = () => `${role[0]}${Date.now().toString(36)}${(++seq).toString(36)}`;
    const pending = new Map(); // id -> {resolve, n, got, timer}
    function wait(id, ms, n) {
      return new Promise(resolve => {
        const timer = setTimeout(() => { pending.delete(id); resolve(undefined); }, ms);
        pending.set(id, { resolve: v => { clearTimeout(timer); pending.delete(id); resolve(v); }, n: n === undefined ? 1 : n, got: 0 });
      });
    }
    function call(fn, args) {
      const id = nextId(); const p = wait(id, 20000);
      if (!send({ k: 'call', id, fn, args: args || {} })) { const q = pending.get(id); if (q) q.resolve(undefined); }
      return p;
    }

    // ---------- Écouteurs chrome.runtime.onMessage ----------
    const listeners = [];
    // Même logique que Chrome : le premier qui répond (sendResponse) gagne ; « return true » = réponse plus tard.
    function dispatch(msg, sender) {
      return new Promise(resolve => {
        let done = false, later = false;
        const respond = v => { if (done) return; done = true; resolve({ value: v }); };
        for (const l of listeners.slice()) {
          try { if (l(msg, sender, respond) === true) later = true; } catch (e) { setTimeout(() => { throw e; }); }
        }
        if (!done && !later) { done = true; resolve({ none: true }); }
        if (!done && later) setTimeout(() => { if (!done) { done = true; resolve({ none: true }); } }, 30000);
      });
    }
    const storageListeners = [], eventListeners = new Map();
    let tabCache = { id: 1, windowId: 1, active: true, url: '', title: '', status: 'complete' };

    function recv(s) {
      let env; try { env = typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return; }
      if (!env || typeof env !== 'object') return;
      if (env.k === 'msg') {
        const sender = LECTEUR ? { id: APP_ID } : { id: APP_ID, tab: { ...tabCache, ...(env.sender && env.sender.tab) }, frameId: env.sender ? env.sender.frameId : 0, url: env.sender ? env.sender.url : '' };
        dispatch(env.msg, sender).then(r => { if (env.id) send({ k: 'reply', id: env.id, frameId: env.sender ? env.sender.frameId : undefined, ...r }); });
        return;
      }
      if (env.k === 'reply') {
        const p = pending.get(env.id); if (!p) return;
        p.got++;
        if (!env.none) p.resolve(env.value); else if (p.n != null && p.got >= p.n) p.resolve(undefined);
        return;
      }
      if (env.k === 'count') { // nombre de cadres du lecteur qui ont reçu le message
        const p = pending.get(env.id); if (!p) return;
        p.n = env.n; if (p.got >= p.n) p.resolve(undefined);
        return;
      }
      if (env.k === 'ret') { const p = pending.get(env.id); if (p) p.resolve(env.error ? undefined : env.value); return; }
      if (env.k === 'event') {
        if (env.name === 'storage') for (const l of storageListeners.slice()) { try { l(env.data || {}, 'local'); } catch (e) {} }
        if (env.name === 'tab' && env.data) tabCache = { ...tabCache, ...env.data };
        for (const l of (eventListeners.get(env.name) || []).slice()) { try { l(env.data); } catch (e) {} }
      }
    }

    // ---------- L'objet chrome ----------
    const evt = arr => ({ addListener: f => { arr.push(f); }, removeListener: f => { const i = arr.indexOf(f); if (i >= 0) arr.splice(i, 1); }, hasListener: f => arr.includes(f) });
    const noop = { addListener() {}, removeListener() {}, hasListener: () => false };
    const params = new URLSearchParams(LECTEUR ? '' : location.search);
    const version = params.get('appv') || '0.1.0-app';

    const runtime = {
      id: APP_ID,
      lastError: undefined,
      getURL: p => new URL(String(p).replace(/^\//, ''), BASE).href,
      getManifest: () => ({ manifest_version: 3, name: 'Cowatch', version, content_scripts: [] }),
      onMessage: evt(listeners),
      onInstalled: noop, onConnect: noop,
      // Le panneau garde une « prise » ouverte pour dire à la page qu'il est affiché : ici, c'est l'appli qui le sait.
      connect: info => ({ name: (info && info.name) || '', onDisconnect: noop, onMessage: noop, postMessage() {}, disconnect() {} }),
      sendMessage(msg) {
        if (LECTEUR) { // vers le salon
          const id = nextId(); const p = wait(id, 30000);
          if (!send({ k: 'msg', id, dir: 'salon', msg, url: location.href })) return Promise.resolve(undefined);
          return p;
        }
        // Dans le salon : panneau, moteur et fond partagent la page (comme les pages d'une extension entre elles).
        return new Promise(r => setTimeout(r)).then(() => dispatch(msg, { id: APP_ID, url: location.href })).then(r => r.value);
      },
    };
    const storage = {
      local: {
        get: keys => call('storage.get', { keys: keys == null ? null : [].concat(keys) }).then(v => v || {}),
        set: obj => call('storage.set', { items: obj || {} }).then(() => undefined),
        remove: keys => call('storage.remove', { keys: [].concat(keys) }).then(() => undefined),
      },
      onChanged: evt(storageListeners),
    };
    const chrome = { runtime, storage };

    if (!LECTEUR) {
      chrome.tabs = {
        // Le seul « onglet » : le lecteur de l'appli (id 1).
        get: () => call('tab.get').then(t => (tabCache = { ...tabCache, ...(t || {}) })),
        query: () => call('tab.get').then(t => [(tabCache = { ...tabCache, ...(t || {}) })]),
        sendMessage(tabId, msg, opts) {
          const id = nextId(); const p = wait(id, 8000, null);
          if (!send({ k: 'msg', id, dir: 'lecteur', msg, frameId: opts && opts.frameId })) return Promise.resolve(undefined);
          return p;
        },
        // Ouvrir une page : la page du micro devient la demande d'autorisation d'Android / iOS ; le reste s'ouvre dans le lecteur
        // (site de la liste) ou dans le navigateur du téléphone.
        create: info => {
          const url = (info && info.url) || '';
          if (/mic\.html(\?|$)/.test(url)) return call('mic.ask').then(() => ({ id: 2 }));
          return call('open', { url }).then(() => ({ id: 1 }));
        },
        update: (id, info) => call('open', { url: (info && info.url) || '' }).then(() => tabCache),
      };
    }
    // Accès réservé à la coque (fond.js, app.js) : appels natifs et événements de l'appli.
    chrome.__coque = {
      role, call, get ready() { return !!(post || (post = transport())); },
      on(name, fn) { if (!eventListeners.has(name)) eventListeners.set(name, []); eventListeners.get(name).push(fn); },
    };
    // Page qui s'en va : l'appli oublie ce cadre (sinon elle attendrait sa réponse).
    if (LECTEUR) self.addEventListener('pagehide', () => { send({ k: 'bye' }); });
    // Bonjour à l'appli (elle enregistre ce cadre) ; on réessaie si l'objet natif n'est pas encore là.
    let tries = 0;
    (function hello() { if (!send({ k: 'hello', role, url: location.href, top: self === self.top }) && ++tries < 50) setTimeout(hello, 100); })();
    return chrome;
  };
})();
// Écran du salon : la coque devient l'objet chrome de la page. Dans le lecteur, l'appli l'assemble dans une portée fermée.
if (typeof __COQUE_LECTEUR__ === 'undefined') {
  const c = __creerCoque('salon');
  try { self.chrome = c; } catch (e) {}
  if (self.chrome !== c) Object.defineProperty(self, 'chrome', { value: c, configurable: true, writable: true });
}
