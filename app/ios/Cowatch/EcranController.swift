import AVFoundation
import UIKit
import WebKit

/// Cowatch sur iPhone : même écran qu'Android. Le lecteur (page du service) en haut ou à gauche, le salon dessous ou à droite.
/// Limites connues (à vérifier en vrai, iPhone mis de côté jusqu'au 5/12) : vidéos protégées (FairPlay) dans une WKWebView,
/// lecture plein écran native d'iOS (nos surcouches n'y apparaissent pas), voix quand l'appli passe en arrière-plan.
final class EcranController: UIViewController, Hote, WKNavigationDelegate, WKUIDelegate {
    private let www = Bundle.main.url(forResource: "www", withExtension: nil)!
    private lazy var sites = Sites(www: www)
    private var lecteur: WKWebView!
    private var salon: WKWebView!
    private var pont: Pont!
    private let pile = UIStackView()
    private let zone = UIStackView()
    private let adresse = UILabel()
    private var contraintes: [NSLayoutConstraint] = []
    private var salonVisible = true
    private var lienEnAttente: URL?
    private var observations: [NSKeyValueObservation] = []

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.027, green: 0.047, blue: 0.039, alpha: 1) // #070C0A
        let pool = WKProcessPool()

        let cs = WKWebViewConfiguration(); cs.processPool = pool
        cs.allowsInlineMediaPlayback = true; cs.mediaTypesRequiringUserActionForPlayback = []
        salon = WKWebView(frame: .zero, configuration: cs)

        let cl = WKWebViewConfiguration(); cl.processPool = pool
        cl.allowsInlineMediaPlayback = true; cl.mediaTypesRequiringUserActionForPlayback = []
        let script = ((try? String(contentsOf: www.appendingPathComponent("lecteur.js"), encoding: .utf8)) ?? "")
            .replacingOccurrences(of: "__COQUE_BASE_VALEUR__", with: www.absoluteString)
        cl.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        lecteur = WKWebView(frame: .zero, configuration: cl)

        pont = Pont(salon: salon, lecteur: lecteur, sites: sites)
        pont.hote = self
        cs.userContentController.add(pont, name: "cowatch")
        cl.userContentController.add(pont, name: "cowatch")
        salon.uiDelegate = self; salon.navigationDelegate = self
        lecteur.navigationDelegate = self; lecteur.uiDelegate = self
        lecteur.allowsBackForwardNavigationGestures = true
        observations = [
            lecteur.observe(\.url) { [weak self] w, _ in self?.majAdresse(w.url); self?.pont.ongletChange() },
            lecteur.observe(\.title) { [weak self] _, _ in self?.pont.ongletChange() },
        ]
        construire()
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .defaultToSpeaker, .mixWithOthers])

        var c = URLComponents(url: www.appendingPathComponent("salon.html"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "tab", value: "1"), URLQueryItem(name: "layout", value: paysage ? "cote" : "bas"),
                        URLQueryItem(name: "appv", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")]
        let page = c.url!
        // Garantie « zéro revente » : l'écran du salon ne joint que nos fichiers, le serveur Cowatch et les polices.
        brider(salon.configuration.userContentController) { [weak self] in
            guard let self = self else { return }
            self.salon.loadFileURL(page, allowingReadAccessTo: self.www)
        }
        if let l = lienEnAttente { lienEnAttente = nil; lienRecu(l) } else { naviguer(www.appendingPathComponent("accueil.html")) }
    }

    /// Règles WebKit : tout est bloqué pour l'écran du salon, sauf nos fichiers, le serveur Cowatch et les polices.
    /// (Les filtres de WebKit n'acceptent pas « a|b » : une règle par adresse permise.)
    private func brider(_ ucc: WKUserContentController, puis: @escaping () -> Void) {
        let hote = URL(string: sites.serveur)?.host ?? "salon-coche-private.onrender.com"
        var filtres = ["^file:", "^data:", "^blob:"]
        for h in [hote, "fonts.googleapis.com", "fonts.gstatic.com"] {
            let e = NSRegularExpression.escapedPattern(for: h)
            filtres += ["^https://\(e)[/:]", "^wss://\(e)[/:]"]
        }
        var regles: [[String: Any]] = [["trigger": ["url-filter": ".*"], "action": ["type": "block"]]]
        regles += filtres.map { f -> [String: Any] in ["trigger": ["url-filter": f], "action": ["type": "ignore-previous-rules"]] }
        guard let donnees = try? JSONSerialization.data(withJSONObject: regles), let json = String(data: donnees, encoding: .utf8) else { puis(); return }
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "cowatch-salon", encodedContentRuleList: json) { liste, _ in
            DispatchQueue.main.async {
                if let liste = liste { ucc.add(liste) }
                // Si WebKit refuse les règles, le salon s'ouvre quand même : le garde-fou de construction reste la protection principale.
                puis()
            }
        }
    }

    // ---------- Écran ----------
    private var paysage: Bool { view.bounds.width > view.bounds.height }
    private func bouton(_ t: String, _ a11y: String, _ action: Selector) -> UIButton {
        let b = UIButton(type: .system); b.setTitle(t, for: .normal); b.accessibilityLabel = a11y
        b.tintColor = UIColor(red: 0.93, green: 0.96, blue: 0.95, alpha: 1); b.addTarget(self, action: action, for: .touchUpInside)
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
        return b
    }
    private func construire() {
        let barre = UIStackView(arrangedSubviews: [bouton("‹", "Revenir en arrière", #selector(arriere)), adresse,
                                                    bouton("Sites", "Choisir un autre site", #selector(accueil)),
                                                    bouton("Salon", "Déplier ou replier le salon", #selector(basculerSalon))])
        barre.axis = .horizontal; barre.alignment = .center
        adresse.textColor = UIColor(red: 0.68, green: 0.76, blue: 0.73, alpha: 1); adresse.font = .systemFont(ofSize: 13)
        adresse.setContentHuggingPriority(.defaultLow, for: .horizontal)
        barre.heightAnchor.constraint(equalToConstant: 44).isActive = true
        zone.axis = .vertical; zone.addArrangedSubview(barre); zone.addArrangedSubview(lecteur)
        pile.addArrangedSubview(zone); pile.addArrangedSubview(salon)
        pile.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(pile)
        NSLayoutConstraint.activate([
            pile.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            pile.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            pile.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            pile.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
        ])
        disposer(paysage: paysage)
    }
    private func disposer(paysage p: Bool) {
        NSLayoutConstraint.deactivate(contraintes)
        pile.axis = p ? .horizontal : .vertical
        contraintes = p ? [salon.widthAnchor.constraint(equalToConstant: 340)]
                        : [salon.heightAnchor.constraint(equalTo: pile.heightAnchor, multiplier: 0.55)]
        NSLayoutConstraint.activate(contraintes)
        salon.isHidden = !salonVisible
        pont?.evenement("layout", ["layout": p ? "cote" : "bas"])
    }
    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: { _ in self.disposer(paysage: size.width > size.height) })
    }
    @objc private func arriere() { if lecteur.canGoBack { lecteur.goBack() } }
    @objc private func accueil() { naviguer(www.appendingPathComponent("accueil.html")) }
    @objc private func basculerSalon() { montrerSalon(!salonVisible) }

    private func naviguer(_ url: URL) {
        if url.isFileURL { lecteur.loadFileURL(url, allowingReadAccessTo: www) } else { lecteur.load(URLRequest(url: url)) }
    }
    private func majAdresse(_ u: URL?) {
        guard let u = u else { adresse.text = ""; return }
        adresse.text = u.isFileURL ? "cowatch · choisis ton site" : (u.scheme == "https" ? "🔒 " : "⚠ ") + (u.host ?? "").replacingOccurrences(of: "www.", with: "")
    }

    // ---------- Navigation : la liste blanche, et le mode « ordinateur » pour les sites qui refusent les téléphones ----------
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel, preferences); return }
        let principal = action.targetFrame?.isMainFrame ?? true
        if webView === salon {
            if url.isFileURL { decisionHandler(.allow, preferences) } else { UIApplication.shared.open(url); decisionHandler(.cancel, preferences) }
            return
        }
        // « Me déconnecter de tous les sites » : seulement depuis notre accueil.
        if url.scheme == "cowatch", url.host == "oublier" {
            if webView.url?.isFileURL == true { oublierSites() }
            decisionHandler(.cancel, preferences); return
        }
        if !principal || url.isFileURL { decisionHandler(.allow, preferences); return }
        guard sites.autorise(url) else {
            if url.scheme == "https" || url.scheme == "http" { UIApplication.shared.open(url) }
            decisionHandler(.cancel, preferences); return
        }
        preferences.preferredContentMode = sites.site(host: url.host)?.ordinateur == true ? .desktop : .mobile
        decisionHandler(.allow, preferences)
    }
    // Certificat douteux : refusé (comportement par défaut, gardé tel quel).

    // Micro du salon : seulement pour notre page.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard webView === salon, origin.protocol == "file", type == .microphone else { decisionHandler(.deny); return }
        demanderMicro { ok in decisionHandler(ok ? .grant : .deny) }
    }

    private func oublierSites() {
        let magasin = lecteur.configuration.websiteDataStore
        magasin.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { enregistrements in
            let sites = enregistrements.filter { r in self.sites.site(host: r.displayName) != nil || self.sites.liste.contains { s in s.domaines.contains(r.displayName) } }
            magasin.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: sites) {}
        }
    }

    // ---------- Hote ----------
    func montrerSalon(_ ouvert: Bool) { salonVisible = ouvert; salon.isHidden = !ouvert; pont.panneau(ouvert) }
    func salonOuvert() -> Bool { salonVisible }
    func ouvrir(_ s: String) {
        guard let u = URL(string: s) else { return }
        if sites.autorise(u) { naviguer(u) } else if u.scheme == "https" { UIApplication.shared.open(u) }
    }
    func partager(_ texte: String, feuille: Bool) -> Bool {
        UIPasteboard.general.string = texte
        if feuille {
            let v = UIActivityViewController(activityItems: ["On regarde ensemble ? Rejoins mon salon Cowatch : \(texte)"], applicationActivities: nil)
            v.popoverPresentationController?.sourceView = salon
            present(v, animated: true)
        }
        return true
    }
    func microAutorise() -> Bool { AVAudioSession.sharedInstance().recordPermission == .granted }
    func demanderMicro(_ fini: @escaping (Bool) -> Void) {
        AVAudioSession.sharedInstance().requestRecordPermission { ok in DispatchQueue.main.async { fini(ok) } }
    }
    func etatSalon(_ etat: [String: Any]) {
        let dans = etat["inRoom"] as? Bool ?? false
        UIApplication.shared.isIdleTimerDisabled = dans
        if dans { try? AVAudioSession.sharedInstance().setActive(true) }
    }
    func onglet() -> [String: Any] {
        ["id": 1, "windowId": 1, "active": true, "url": lecteur.url?.absoluteString ?? "", "title": lecteur.title ?? "", "status": "complete"]
    }

    // ---------- Invitation ----------
    func lienRecu(_ url: URL) {
        guard isViewLoaded, pont != nil else { lienEnAttente = url; return }
        guard let inv = sites.invitation(url) else { return }
        pont.ecrireStockage(["pendingJoin": ["code": inv.code, "at": Int(Date().timeIntervalSince1970 * 1000)]])
        naviguer(inv.page ?? www.appendingPathComponent("accueil.html"))
        montrerSalon(true)
    }
}
