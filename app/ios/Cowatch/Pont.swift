import WebKit

/// Ce que le pont demande à l'écran.
protocol Hote: AnyObject {
    func montrerSalon(_ ouvert: Bool)
    func salonOuvert() -> Bool
    func ouvrir(_ url: String)
    func partager(_ texte: String, feuille: Bool) -> Bool
    func demanderMicro(_ fini: @escaping (Bool) -> Void)
    func microAutorise() -> Bool
    func etatSalon(_ etat: [String: Any])
    func onglet() -> [String: Any]
}

/// Même contrat que Pont.kt (Android) et app/test/natif-simule.js (testé).
/// Sur iPhone, le gestionnaire de messages existe dans toutes les pages : on vérifie donc l'origine de chaque message.
final class Pont: NSObject, WKScriptMessageHandler {
    private static let appelsLecteur: Set<String> = ["storage.get"]
    private static let clesLecteur: Set<String> = ["pendingJoin"]

    weak var hote: Hote?
    private let salon: WKWebView
    private let lecteur: WKWebView
    private let sites: Sites
    private let stockage = Stockage()
    private var cadres: [String: WKFrameInfo] = [:] // jeton du cadre (coque.js) -> cadre
    private var numeros: [String: Int] = [:]
    private var prochain = 1

    init(salon: WKWebView, lecteur: WKWebView, sites: Sites) {
        self.salon = salon; self.lecteur = lecteur; self.sites = sites
    }

    // ---------- Envois ----------
    private func js(_ env: [String: Any]) -> String? {
        guard let d = try? JSONSerialization.data(withJSONObject: env), let s = String(data: d, encoding: .utf8),
              let lit = try? JSONSerialization.data(withJSONObject: [s]), let l = String(data: lit, encoding: .utf8) else { return nil }
        return "window.__coqueRecv && window.__coqueRecv(\(l)[0])"
    }
    private func versSalon(_ env: [String: Any]) { if let c = js(env) { salon.evaluateJavaScript(c, completionHandler: nil) } }
    private func versCadre(_ f: WKFrameInfo, _ env: [String: Any]) {
        if let c = js(env) { lecteur.evaluateJavaScript(c, in: f, in: .page, completionHandler: nil) }
    }
    func ongletChange() { versSalon(["k": "event", "name": "tab", "data": hote?.onglet() ?? [:]]) }
    func evenement(_ nom: String, _ data: Any = NSNull()) { versSalon(["k": "event", "name": nom, "data": data]) }
    func panneau(_ ouvert: Bool) { for f in cadres.values { versCadre(f, ["k": "msg", "msg": ["t": "panel", "open": ouvert]]) } }
    func ecrireStockage(_ items: [String: Any]) { changements(stockage.ecrire(items)) }
    private func changements(_ ch: [String: Any]) {
        if ch.isEmpty { return }
        versSalon(["k": "event", "name": "storage", "data": ch])
        let pub = ch.filter { Pont.clesLecteur.contains($0.key) }
        if !pub.isEmpty { for f in cadres.values { versCadre(f, ["k": "event", "name": "storage", "data": pub]) } }
    }

    // ---------- Réception ----------
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let s = message.body as? String, let data = s.data(using: .utf8),
              let env = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if message.webView === salon {
            guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "file" else { return }
            depuisSalon(env)
        } else if message.webView === lecteur {
            guard message.frameInfo.securityOrigin.protocol == "https", sites.site(host: message.frameInfo.securityOrigin.host) != nil else { return }
            depuisLecteur(env, message.frameInfo)
        }
    }

    private func depuisLecteur(_ env: [String: Any], _ f: WKFrameInfo) {
        guard let jeton = env["cadre"] as? String else { return }
        let k = env["k"] as? String
        if k == "hello" && f.isMainFrame { cadres.removeAll(); numeros.removeAll() }
        if k == "bye" { cadres.removeValue(forKey: jeton); return }
        cadres[jeton] = f
        let fid = numeros[jeton] ?? { let n = prochain; prochain += 1; numeros[jeton] = n; return n }()
        switch k {
        case "hello": if f.isMainFrame { ongletChange() }
        case "msg":
            guard env["dir"] as? String == "salon" else { return }
            var sender: [String: Any] = ["frameId": fid, "url": env["url"] ?? ""]
            sender["tab"] = hote?.onglet() ?? [:]
            versSalon(["k": "msg", "id": env["id"] ?? NSNull(), "msg": env["msg"] ?? NSNull(), "sender": sender])
        case "reply":
            versSalon(["k": "reply", "id": env["id"] ?? NSNull(), "value": env["value"] ?? NSNull(), "none": env["none"] as? Bool ?? false])
        case "call":
            let fn = env["fn"] as? String ?? ""
            guard Pont.appelsLecteur.contains(fn) else { versCadre(f, ["k": "ret", "id": env["id"] ?? NSNull(), "error": "refusé"]); return }
            let cles = (((env["args"] as? [String: Any])?["keys"] as? [String]) ?? []).filter { Pont.clesLecteur.contains($0) }
            versCadre(f, ["k": "ret", "id": env["id"] ?? NSNull(), "value": stockage.lire(cles)])
        default: break
        }
    }

    private func depuisSalon(_ env: [String: Any]) {
        switch env["k"] as? String {
        case "hello": ongletChange()
        case "msg":
            guard env["dir"] as? String == "lecteur" else { return }
            let id = env["id"] ?? NSNull()
            var cibles = Array(cadres.values)
            if let fid = env["frameId"] as? Int { cibles = numeros.filter { $0.value == fid }.compactMap { cadres[$0.key] } }
            versSalon(["k": "count", "id": id, "n": cibles.count])
            for f in cibles { versCadre(f, ["k": "msg", "id": id, "msg": env["msg"] ?? NSNull(), "sender": ["id": "cowatch-app"]]) }
        case "reply":
            guard let fid = env["frameId"] as? Int, let jeton = numeros.first(where: { $0.value == fid })?.key, let f = cadres[jeton] else { return }
            versCadre(f, ["k": "reply", "id": env["id"] ?? NSNull(), "value": env["value"] ?? NSNull(), "none": env["none"] as? Bool ?? false])
        case "call": appel(env["id"] ?? NSNull(), env["fn"] as? String ?? "", env["args"] as? [String: Any] ?? [:])
        default: break
        }
    }

    private func appel(_ id: Any, _ fn: String, _ a: [String: Any]) {
        let rendre: (Any?) -> Void = { [weak self] v in self?.versSalon(["k": "ret", "id": id, "value": v ?? NSNull()]) }
        switch fn {
        case "storage.get": rendre(stockage.lire(a["keys"] as? [String]))
        case "storage.set": changements(stockage.ecrire(a["items"] as? [String: Any] ?? [:])); rendre(nil)
        case "storage.remove": changements(stockage.effacer(a["keys"] as? [String] ?? [])); rendre(nil)
        case "tab.get": rendre(hote?.onglet())
        case "panel.open": hote?.montrerSalon(true); rendre(["ok": true])
        case "panel.state": rendre(["open": hote?.salonOuvert() ?? true])
        case "open": hote?.ouvrir(a["url"] as? String ?? ""); rendre(nil)
        case "clip": rendre(["ok": hote?.partager(a["text"] as? String ?? "", feuille: a["share"] as? Bool ?? false) ?? false])
        case "mic.state": rendre(["state": (hote?.microAutorise() ?? false) ? "granted" : "prompt"])
        case "mic.ask": hote?.demanderMicro { [weak self] ok in rendre(["granted": ok]); if ok { self?.evenement("micGranted") } }
        case "room.state": hote?.etatSalon(a); rendre(nil)
        default: versSalon(["k": "ret", "id": id, "error": "inconnu"])
        }
    }
}
