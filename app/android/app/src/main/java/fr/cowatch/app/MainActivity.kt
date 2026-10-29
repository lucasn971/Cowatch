package fr.cowatch.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.UserAgentMetadata
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Cowatch sur Android, « mode B » : le site du service s'affiche dans l'appli (comme Rave), avec le calage de l'extension.
 *  - en haut (portrait) ou à gauche (paysage) : le lecteur, c'est-à-dire la vraie page du service, son adresse toujours visible ;
 *  - en bas ou à droite : l'écran du salon (le panneau de l'extension : groupe, voix, chat, ambiances) ;
 *  - plein écran de la vidéo : le salon se replie, la languette « Cowatch » de la vidéo le rouvre.
 */
class MainActivity : ComponentActivity(), Hote {
    companion object {
        private const val HOTE_APP = "appassets.androidplatform.net"
        private const val ACCUEIL = Pont.BASE_APP + "accueil.html"
    }

    private lateinit var sites: Sites
    private lateinit var stockage: Stockage
    private lateinit var pont: Pont
    private lateinit var racine: FrameLayout
    private lateinit var contenu: LinearLayout
    private lateinit var zoneLecteur: LinearLayout
    private lateinit var adresse: TextView
    private lateinit var lecteur: WebView
    private lateinit var salon: WebView
    private lateinit var pleinEcran: FrameLayout

    private var vuePleinEcran: View? = null
    private var finPleinEcran: WebChromeClient.CustomViewCallback? = null
    private var salonVisible = true
    private var dansSalon = false
    private var modeOrdinateur: Boolean? = null
    private var uaDefaut = ""
    private var metaDefaut: UserAgentMetadata? = null
    private var titre = ""
    private val attentesMicro = mutableListOf<(Boolean) -> Unit>()
    private var fichierAttente: ValueCallback<Array<Uri>>? = null

    private val chargeur by lazy {
        WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
    }
    private val demandeMicro = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val l = attentesMicro.toList(); attentesMicro.clear(); l.forEach { it(ok) }
        if (!ok) Toast.makeText(this, R.string.micro_refuse, Toast.LENGTH_LONG).show()
    }
    private val demandeNotif = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private val choixPhoto = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fichierAttente?.onReceiveValue(uri?.let { arrayOf(it) }); fichierAttente = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            setContentView(TextView(this).apply {
                text = getString(R.string.webview_trop_vieux); setPadding(dp(24), dp(48), dp(24), dp(24))
                setTextColor(getColor(R.color.texte)); setBackgroundColor(getColor(R.color.fond)); textSize = 16f
            })
            return
        }
        sites = Sites(this)
        stockage = Stockage(this)
        WebView.setWebContentsDebuggingEnabled(0 != (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE))
        construireEcran()
        reglerSalon()
        reglerLecteur()
        pont = Pont(this, salon, lecteur, stockage, sites)
        val script = assets.open("www/lecteur.js").bufferedReader().use { it.readText() }.replace("__COQUE_BASE_VALEUR__", Pont.BASE_APP)
        pont.installer(script)
        SalonService.surAction = { action -> runOnUiThread { pont.evenement(action) } }
        salon.loadUrl(urlSalon())
        if (!traiterLien(intent)) naviguer(ACCUEIL)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { retour() }
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (::pont.isInitialized) traiterLien(intent)
    }

    // ---------- Écran ----------
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun bouton(texte: String, description: String, action: () -> Unit) = TextView(this).apply {
        text = texte; contentDescription = description; gravity = Gravity.CENTER; textSize = 15f
        setTextColor(getColor(R.color.texte)); setPadding(dp(12), 0, dp(12), 0)
        val tv = TypedValue(); context.theme.resolveAttribute(android.R.attr.selectableItemBackground, tv, true)
        setBackgroundResource(tv.resourceId); isClickable = true; isFocusable = true
        setOnClickListener { action() }
    }

    private fun construireEcran() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        racine = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.fond)) }
        contenu = LinearLayout(this)
        zoneLecteur = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val barre = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(getColor(R.color.fond))
        }
        adresse = TextView(this).apply {
            textSize = 13f; setTextColor(getColor(R.color.discret)); maxLines = 1; ellipsize = TextUtils.TruncateAt.END
            contentDescription = "Adresse de la page affichée"
        }
        barre.addView(bouton("‹", "Revenir en arrière") { if (lecteur.canGoBack()) lecteur.goBack() }, LinearLayout.LayoutParams(dp(48), dp(44)))
        barre.addView(adresse, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        barre.addView(bouton("Sites", "Choisir un autre site") { naviguer(ACCUEIL) }, LinearLayout.LayoutParams(WRAP_CONTENT, dp(44)))
        barre.addView(bouton("Salon", "Déplier ou replier le salon") { montrerSalon(!salonVisible) }, LinearLayout.LayoutParams(WRAP_CONTENT, dp(44)))
        lecteur = WebView(this)
        salon = WebView(this)
        zoneLecteur.addView(barre, LinearLayout.LayoutParams(MATCH_PARENT, dp(44)))
        zoneLecteur.addView(lecteur, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        contenu.addView(zoneLecteur)
        contenu.addView(salon)
        pleinEcran = FrameLayout(this).apply { visibility = View.GONE; setBackgroundColor(Color.BLACK) }
        racine.addView(contenu, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        racine.addView(pleinEcran, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setContentView(racine)
        ViewCompat.setOnApplyWindowInsetsListener(racine) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            if (vuePleinEcran == null) v.setPadding(b.left, b.top, b.right, b.bottom) else v.setPadding(0, 0, 0, 0)
            WindowInsetsCompat.CONSUMED
        }
        disposer()
    }

    private fun paysage() = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

    /** Portrait : le lecteur en haut, le salon dessous (comme une soirée devant un téléphone). Paysage : le salon à droite. */
    private fun disposer() {
        val p = paysage()
        contenu.orientation = if (p) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        zoneLecteur.layoutParams = if (p) LinearLayout.LayoutParams(0, MATCH_PARENT, 1f) else LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f)
        salon.layoutParams = if (p) LinearLayout.LayoutParams(dp(340), MATCH_PARENT) else LinearLayout.LayoutParams(MATCH_PARENT, 0, 1.25f)
        salon.visibility = if (salonVisible) View.VISIBLE else View.GONE
        if (::pont.isInitialized) pont.evenement("layout", JSONObject().put("layout", if (p) "cote" else "bas"))
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::salon.isInitialized) disposer()
    }

    private fun urlSalon(): String {
        val version = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (e: Exception) { "" }
        var url = "${Pont.BASE_APP}salon.html?tab=1&appv=${Uri.encode(version)}&layout=${if (paysage()) "cote" else "bas"}"
        // Essais en développement seulement : serveur Cowatch lancé sur l'ordinateur (adb … -e server http://10.0.2.2:8080).
        val essai = intent?.getStringExtra("server")
        if (essai != null && 0 != (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)) url += "&server=${Uri.encode(essai)}"
        return url
    }

    // ---------- L'écran du salon (notre page) ----------
    @SuppressLint("SetJavaScriptEnabled")
    private fun reglerSalon() {
        salon.setBackgroundColor(getColor(R.color.fond))
        salon.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false; allowContentAccess = false
        }
        salon.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                chargeur.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOTE_APP) return false
                ouvrirDehors(request.url); return true
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) { handler.cancel() }
        }
        salon.webChromeClient = object : WebChromeClient() {
            // Le micro, pour la voix du salon : seulement pour notre page, et après l'accord d'Android.
            override fun onPermissionRequest(request: PermissionRequest) {
                val audio = PermissionRequest.RESOURCE_AUDIO_CAPTURE
                if (request.origin.host != HOTE_APP || audio !in request.resources) { request.deny(); return }
                runOnUiThread { demanderMicro { ok -> if (ok) request.grant(arrayOf(audio)) else request.deny() } }
            }
            // « Ajouter ma photo » du panneau.
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
                fichierAttente?.onReceiveValue(null); fichierAttente = cb
                choixPhoto.launch("image/*"); return true
            }
        }
    }

    // ---------- Le lecteur (la page du service) ----------
    @SuppressLint("SetJavaScriptEnabled")
    private fun reglerLecteur() {
        uaDefaut = lecteur.settings.userAgentString
        if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) {
            try { metaDefaut = WebSettingsCompat.getUserAgentMetadata(lecteur.settings) } catch (e: Throwable) {}
        }
        lecteur.setBackgroundColor(Color.BLACK)
        lecteur.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false; allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false; setSupportMultipleWindows(false)
            useWideViewPort = true; loadWithOverviewMode = true; builtInZoomControls = true; displayZoomControls = false
        }
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(lecteur, true) }
        lecteur.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val u = request.url
                if (u.host == HOTE_APP) { appliquerUa(false); return false }
                if (!sites.autorise(u)) {
                    // Hors liste (aide, paiement, connexion Google…) : le navigateur du téléphone, jamais notre lecteur.
                    if (u.scheme == "https" || u.scheme == "http") ouvrirDehors(u)
                    return true
                }
                val ordinateur = sites.siteDe(u.host)?.ordinateur == true
                if (ordinateur != modeOrdinateur) { appliquerUa(ordinateur); view.loadUrl(u.toString()); return true }
                return false
            }
            // Notre accueil et nos polices, servis depuis l'appli (avec l'en-tête qui permet aux pages des services de les lire).
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host != HOTE_APP) return null
                val r = chargeur.shouldInterceptRequest(request.url) ?: return null
                r.responseHeaders = HashMap(r.responseHeaders ?: emptyMap()).apply { put("Access-Control-Allow-Origin", "*") }
                return r
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) { majAdresse(url) }
            override fun onPageFinished(view: WebView, url: String?) { majAdresse(url); if (::pont.isInitialized) pont.ongletChange() }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) { majAdresse(url); if (::pont.isInitialized) pont.ongletChange() }
            // Certificat douteux : on n'ouvre pas la page (Rave ignore ces erreurs).
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) { handler.cancel() }
        }
        lecteur.webChromeClient = object : WebChromeClient() {
            // Vidéo protégée (Widevine) : seulement pour les sites de la liste.
            override fun onPermissionRequest(request: PermissionRequest) {
                val drm = PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
                if (drm in request.resources && sites.autorise(request.origin)) request.grant(arrayOf(drm)) else request.deny()
            }
            override fun onReceivedTitle(view: WebView, t: String?) { titre = t ?: ""; if (::pont.isInitialized) pont.ongletChange() }
            override fun onShowCustomView(view: View, callback: WebChromeClient.CustomViewCallback) { entrerPleinEcran(view, callback) }
            override fun onHideCustomView() { sortirPleinEcran() }
        }
    }

    /** Netflix, Canal+, Crunchyroll… refusent les navigateurs de téléphone : l'appli se présente alors comme un ordinateur. */
    private fun appliquerUa(ordinateur: Boolean) {
        if (ordinateur == modeOrdinateur) return
        modeOrdinateur = ordinateur
        val chromeV = Regex("Chrome/([\\d.]+)").find(uaDefaut)?.groupValues?.get(1) ?: "130.0.0.0"
        lecteur.settings.userAgentString = if (ordinateur)
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$chromeV Safari/537.36"
        else uaDefaut
        if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) try {
            val meta = if (ordinateur) {
                val b = UserAgentMetadata.Builder()
                metaDefaut?.let { d -> b.setBrandVersionList(d.brandVersionList); d.fullVersion?.let { b.setFullVersion(it) } }
                b.setMobile(false).setPlatform("Windows").setPlatformVersion("10.0.0").setModel("").build()
            } else metaDefaut
            if (meta != null) WebSettingsCompat.setUserAgentMetadata(lecteur.settings, meta)
        } catch (e: Throwable) { /* WebView trop ancienne : seule l'identité de navigateur change */ }
    }

    private fun naviguer(url: String) {
        val u = Uri.parse(url)
        appliquerUa(sites.siteDe(u.host)?.ordinateur == true)
        lecteur.loadUrl(url)
    }

    private fun majAdresse(url: String?) {
        val u = url?.let { Uri.parse(it) }
        adresse.text = when {
            u == null -> ""
            u.host == HOTE_APP -> "cowatch · choisis ton site"
            else -> (if (u.scheme == "https") "🔒 " else "⚠ ") + (u.host ?: "").removePrefix("www.")
        }
    }

    private fun ouvrirDehors(u: Uri) {
        try { startActivity(Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)) } catch (e: Exception) {}
        Toast.makeText(this, R.string.hors_liste, Toast.LENGTH_SHORT).show()
    }

    // ---------- Plein écran de la vidéo ----------
    private fun entrerPleinEcran(vue: View, fin: WebChromeClient.CustomViewCallback) {
        if (vuePleinEcran != null) { fin.onCustomViewHidden(); return }
        vuePleinEcran = vue; finPleinEcran = fin
        pleinEcran.addView(vue, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        pleinEcran.visibility = View.VISIBLE; contenu.visibility = View.GONE
        WindowCompat.getInsetsController(window, racine).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        racine.setPadding(0, 0, 0, 0)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        pont.panneau(false)
    }

    private fun sortirPleinEcran() {
        val vue = vuePleinEcran ?: return
        pleinEcran.removeView(vue); pleinEcran.visibility = View.GONE; contenu.visibility = View.VISIBLE
        vuePleinEcran = null
        finPleinEcran?.onCustomViewHidden(); finPleinEcran = null
        WindowCompat.getInsetsController(window, racine).show(WindowInsetsCompat.Type.systemBars())
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        ViewCompat.requestApplyInsets(racine)
        pont.panneau(salonVisible)
    }

    // ---------- Ce que demande le pont (interface Hote) ----------
    override fun montrerSalon(ouvert: Boolean) {
        if (ouvert && vuePleinEcran != null) sortirPleinEcran()
        salonVisible = ouvert
        salon.visibility = if (ouvert) View.VISIBLE else View.GONE
        pont.panneau(ouvert)
    }
    override fun salonOuvert() = salonVisible && vuePleinEcran == null
    override fun ouvrir(url: String) {
        val u = Uri.parse(url)
        if (u.host == HOTE_APP || sites.autorise(u)) naviguer(url) else if (u.scheme == "https") ouvrirDehors(u)
    }
    override fun partager(texte: String, feuille: Boolean): Boolean {
        getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Cowatch", texte))
        if (feuille) {
            val envoi = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "On regarde ensemble ? Rejoins mon salon Cowatch : $texte")
            try { startActivity(Intent.createChooser(envoi, getString(R.string.partager))) } catch (e: Exception) { return false }
        } else Toast.makeText(this, R.string.lien_copie, Toast.LENGTH_SHORT).show()
        return true
    }
    override fun microAutorise() = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    override fun demanderMicro(fini: (Boolean) -> Unit) {
        if (microAutorise()) { fini(true); return }
        attentesMicro.add(fini)
        if (attentesMicro.size == 1) demandeMicro.launch(Manifest.permission.RECORD_AUDIO)
    }
    override fun etatSalon(etat: JSONObject) {
        val dans = etat.optBoolean("inRoom")
        if (dans) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (!dansSalon && Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                demandeNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
            SalonService.maj(this, etat.optString("code"), etat.optBoolean("muted"), etat.optInt("peers", 1))
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (dansSalon) SalonService.arreter(this)
        }
        dansSalon = dans
    }
    override fun ongletUrl() = lecteur.url ?: ""
    override fun ongletTitre() = titre

    // ---------- Lien d'invitation ----------
    private fun traiterLien(i: Intent?): Boolean {
        val (code, page) = sites.invitation(i?.data) ?: return false
        pont.ecrireStockage(JSONObject().put("pendingJoin", JSONObject().put("code", code).put("at", System.currentTimeMillis())))
        naviguer(page?.toString() ?: ACCUEIL)
        montrerSalon(true)
        return true
    }

    private fun retour() {
        when {
            vuePleinEcran != null -> sortirPleinEcran()
            lecteur.canGoBack() -> lecteur.goBack()
            dansSalon -> moveTaskToBack(true) // on garde le salon et la voix
            else -> finish()
        }
    }

    // ---------- Cycle de vie : en salon, rien ne s'endort (voix, calage) ----------
    override fun onStart() {
        super.onStart()
        if (::lecteur.isInitialized) { lecteur.onResume(); salon.onResume() }
    }
    override fun onStop() {
        super.onStop()
        if (::lecteur.isInitialized && !dansSalon) { lecteur.onPause(); salon.onPause() }
    }
    override fun onDestroy() {
        SalonService.surAction = null
        if (::lecteur.isInitialized) {
            SalonService.arreter(this)
            lecteur.destroy(); salon.destroy()
        }
        super.onDestroy()
    }
}
