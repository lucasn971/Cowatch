import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private let ecran = EcranController()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = ecran
        w.makeKeyAndVisible()
        window = w
        if let url = launchOptions?[.url] as? URL { ecran.lienRecu(url) }
        return true
    }

    // Lien d'invitation cowatch://j/CODE?u=… (les liens https://…/j/CODE demandent des « associated domains », plus tard).
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        ecran.lienRecu(url)
        return true
    }
}
