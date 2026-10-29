import Foundation

/// Liste blanche partagée avec Android et l'accueil (www/sites.json).
struct Site { let id: String; let nom: String; let accueil: String; let domaines: [String]; let ordinateur: Bool }

final class Sites {
    let liste: [Site]
    let serveur: String

    init(www: URL) {
        var l: [Site] = []
        var srv = "https://salon-coche-private.onrender.com"
        if let data = try? Data(contentsOf: www.appendingPathComponent("sites.json")),
           let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            for s in (o["sites"] as? [[String: Any]]) ?? [] {
                l.append(Site(id: s["id"] as? String ?? "", nom: s["nom"] as? String ?? "", accueil: s["accueil"] as? String ?? "",
                              domaines: ((s["domaines"] as? [String]) ?? []).map { $0.lowercased() }, ordinateur: (s["ua"] as? String) == "ordinateur"))
            }
            if let app = o["app"] as? [String: Any], let v = app["serveur"] as? String, !v.isEmpty { srv = v }
        }
        liste = l; serveur = srv
    }

    func site(host: String?) -> Site? {
        guard let h = host?.lowercased() else { return nil }
        return liste.first { s in s.domaines.contains { h == $0 || h.hasSuffix("." + $0) } }
    }
    func autorise(_ url: URL?) -> Bool { url?.scheme == "https" && site(host: url?.host) != nil }

    /// cowatch://j/CODE?u=<page> ou https://<serveur>/j/CODE?u=<page>
    func invitation(_ url: URL) -> (code: String, page: URL?)? {
        let c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let parts = url.pathComponents.filter { $0 != "/" }
        var code: String?
        if url.scheme == "cowatch", url.host == "j" { code = parts.first }
        if url.scheme == "https", url.host == URL(string: serveur)?.host, parts.count >= 2, parts[0] == "j" { code = parts[1] }
        guard let k = code, k.range(of: "^[A-Za-z0-9-]{3,24}$", options: .regularExpression) != nil else { return nil }
        let page = c?.queryItems?.first { $0.name == "u" }?.value.flatMap { URL(string: $0) }
        return (k.uppercased(), autorise(page) ? page : nil)
    }
}

/// chrome.storage.local de l'appli, sur le téléphone seulement.
final class Stockage {
    private let d = UserDefaults(suiteName: "cowatch-stockage") ?? .standard
    private func lireValeur(_ k: String) -> Any? {
        guard let s = d.string(forKey: k), let data = s.data(using: .utf8),
              let a = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? [Any] else { return nil }
        return a.first
    }
    func lire(_ cles: [String]?) -> [String: Any] {
        var out: [String: Any] = [:]
        let toutes = cles ?? d.dictionaryRepresentation().keys.filter { d.string(forKey: $0) != nil }
        for k in toutes { if let v = lireValeur(k) { out[k] = v } }
        return out
    }
    func ecrire(_ items: [String: Any]) -> [String: Any] {
        var ch: [String: Any] = [:]
        for (k, v) in items {
            var c: [String: Any] = ["newValue": v]
            if let a = lireValeur(k) { c["oldValue"] = a }
            if let data = try? JSONSerialization.data(withJSONObject: [v], options: [.fragmentsAllowed]) { d.set(String(data: data, encoding: .utf8), forKey: k) }
            ch[k] = c
        }
        return ch
    }
    func effacer(_ cles: [String]) -> [String: Any] {
        var ch: [String: Any] = [:]
        for k in cles { if let a = lireValeur(k) { ch[k] = ["oldValue": a]; d.removeObject(forKey: k) } }
        return ch
    }
}
