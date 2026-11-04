package fr.cowatch.app

import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.IdentityHashMap

/** Ce que le pont demande à l'écran (MainActivity). */
interface Hote {
    fun montrerSalon(ouvert: Boolean)
    fun salonOuvert(): Boolean
    fun ouvrir(url: String)
    fun partager(texte: String, feuille: Boolean): Boolean
    fun demanderMicro(fini: (Boolean) -> Unit)
    fun microAutorise(): Boolean
    fun etatSalon(etat: JSONObject)
    fun ongletUrl(): String
    fun ongletTitre(): String
    /** Mode A : état du lecteur de l'appli officielle, et commandes lecture / pause / aller à (AppliOfficielle). */
    fun mediaEtat(): JSONObject
    fun mediaCommande(fn: String, args: JSONObject)
}

/**
 * Le pont entre l'écran du salon (notre page) et le lecteur (la page du service et ses cadres).
 * Même contrat que app/test/natif-simule.js (testé) et Pont.swift (iPhone) :
 *   page → appli : hello · bye · msg {id,dir,msg,url,frameId?} · reply {id,value,none,frameId?} · call {id,fn,args}
 *   appli → page : msg {id,msg,sender} · reply {id,value,none} · count {id,n} · ret {id,value,error} · event {name,data}
 *
 * Sécurité (ce que Rave ne fait pas) : l'objet natif n'existe que dans les pages des origines autorisées
 * (WebViewCompat.addWebMessageListener), et le lecteur n'a droit qu'à lire l'invitation en attente.
 *
 * Mode A : une 3e page, « pilote » (notre page pilote.html, cachée), présente le lecteur de l'appli officielle comme une
 * <video> au cœur. C'est le cadre n° 0. Elle n'a droit qu'à lire l'invitation et à lire / commander la lecture.
 */
class Pont(
    private val hote: Hote,
    private val salon: WebView,
    private val lecteur: WebView,
    private val pilote: WebView,
    private val stockage: Stockage,
    private val sites: Sites,
) {
    companion object {
        const val ORIGINE_APP = "https://appassets.androidplatform.net"
        const val BASE_APP = "$ORIGINE_APP/assets/www/"
        private val APPELS_LECTEUR = setOf("storage.get")
        private val CLES_LECTEUR = setOf("pendingJoin")
        private val APPELS_PILOTE = setOf("storage.get", "media.etat", "media.play", "media.pause", "media.seek")
        const val PILOTE = 0
    }
    private var piloteProxy: JavaScriptReplyProxy? = null

    private var salonProxy: JavaScriptReplyProxy? = null
    private val cadres = LinkedHashMap<Int, JavaScriptReplyProxy>()
    private val idsCadres = IdentityHashMap<JavaScriptReplyProxy, Int>()
    private var prochainCadre = 1

    fun installer(scriptLecteur: String) {
        WebViewCompat.addWebMessageListener(salon, "CowatchNative", setOf(ORIGINE_APP),
            WebViewCompat.WebMessageListener { _, message, _, isMainFrame, proxy ->
                val data = message.data ?: return@WebMessageListener
                if (isMainFrame) depuisSalon(data, proxy)
            })
        val regles = sites.reglesOrigine()
        WebViewCompat.addWebMessageListener(lecteur, "CowatchNative", regles,
            WebViewCompat.WebMessageListener { _, message, origine, isMainFrame, proxy ->
                val data = message.data ?: return@WebMessageListener
                if (sites.siteDe(origine.host) == null) return@WebMessageListener // double vérification
                depuisLecteur(data, isMainFrame, proxy)
            })
        // Comme les scripts de contenu de l'extension : dans la page du service et dans tous ses cadres, dès le début.
        WebViewCompat.addDocumentStartJavaScript(lecteur, scriptLecteur, regles)
        // Mode A : la page pilote (la nôtre, servie par l'appli) ; seul son cadre principal compte.
        WebViewCompat.addWebMessageListener(pilote, "CowatchNative", setOf(ORIGINE_APP),
            WebViewCompat.WebMessageListener { _, message, _, isMainFrame, proxy ->
                val data = message.data ?: return@WebMessageListener
                if (isMainFrame) depuisPilote(data, proxy)
            })
    }

    /** Tous les cadres qui jouent le rôle de « lecteur » : ceux de la page du service, et la page pilote du mode A. */
    private fun tousLesCadres(): List<JavaScriptReplyProxy> = cadres.values.toList() + listOfNotNull(piloteProxy)
    private fun cadre(id: Int): JavaScriptReplyProxy? = if (id == PILOTE) piloteProxy else cadres[id]

    /** Mode A : nouvelle de l'appli officielle (lecture, pause, position…) vers la page pilote. */
    fun media(etat: JSONObject) { piloteProxy?.let { versCadre(it, JSONObject().put("k", "event").put("name", "media").put("data", etat)) } }

    private fun depuisPilote(data: String, proxy: JavaScriptReplyProxy) {
        val env = try { JSONObject(data) } catch (e: Exception) { return }
        when (env.optString("k")) {
            "hello" -> piloteProxy = proxy
            "bye" -> if (piloteProxy === proxy) piloteProxy = null
            "msg" -> {
                piloteProxy = proxy
                if (env.optString("dir") != "salon") return
                val sender = JSONObject().put("frameId", PILOTE).put("url", env.optString("url")).put("tab", onglet())
                versSalon(JSONObject().put("k", "msg").put("id", env.opt("id")).put("msg", env.opt("msg")).put("sender", sender))
            }
            "reply" -> versSalon(JSONObject().put("k", "reply").put("id", env.opt("id")).put("value", env.opt("value")).put("none", env.optBoolean("none")))
            "call" -> {
                val id = env.opt("id"); val fn = env.optString("fn"); val args = env.optJSONObject("args") ?: JSONObject()
                val rendre = { v: Any? -> versCadre(proxy, JSONObject().put("k", "ret").put("id", id).put("value", v ?: JSONObject.NULL)) }
                when {
                    fn !in APPELS_PILOTE -> versCadre(proxy, JSONObject().put("k", "ret").put("id", id).put("error", "refusé"))
                    fn == "storage.get" -> {
                        val demandees = args.optJSONArray("keys")
                        rendre(stockage.lire((0 until (demandees?.length() ?: 0)).map { demandees!!.optString(it) }.filter { it in CLES_LECTEUR }))
                    }
                    fn == "media.etat" -> rendre(hote.mediaEtat())
                    else -> { hote.mediaCommande(fn, args); rendre(JSONObject().put("ok", true)) }
                }
            }
        }
    }

    // ---------- Vers les pages ----------
    private fun versSalon(env: JSONObject) { try { salonProxy?.postMessage(env.toString()) } catch (e: Exception) {} }
    private fun versCadre(p: JavaScriptReplyProxy, env: JSONObject) { try { p.postMessage(env.toString()) } catch (e: Exception) {} }
    private fun idDe(p: JavaScriptReplyProxy): Int = idsCadres.getOrPut(p) { prochainCadre++ }

    fun onglet(): JSONObject = JSONObject()
        .put("id", 1).put("windowId", 1).put("active", true)
        .put("url", hote.ongletUrl()).put("title", hote.ongletTitre()).put("status", "complete")

    /** Nouvelle page dans le lecteur : ses anciens cadres n'existent plus. */
    fun nouvellePage() { cadres.clear(); idsCadres.clear() }
    fun ongletChange() = versSalon(JSONObject().put("k", "event").put("name", "tab").put("data", onglet()))
    fun evenement(nom: String, data: Any? = null) = versSalon(JSONObject().put("k", "event").put("name", nom).put("data", data ?: JSONObject.NULL))

    /** Le salon est déplié ou replié : la page du service affiche ou cache sa languette « Cowatch ». */
    fun panneau(ouvert: Boolean) {
        val env = JSONObject().put("k", "msg").put("msg", JSONObject().put("t", "panel").put("open", ouvert))
        for (p in tousLesCadres()) versCadre(p, env)
    }

    private fun changementsStockage(ch: JSONObject) {
        if (ch.length() == 0) return
        versSalon(JSONObject().put("k", "event").put("name", "storage").put("data", ch))
        val publics = JSONObject()
        for (k in ch.keys()) if (k in CLES_LECTEUR) publics.put(k, ch.get(k))
        if (publics.length() > 0) {
            val env = JSONObject().put("k", "event").put("name", "storage").put("data", publics)
            for (p in tousLesCadres()) versCadre(p, env)
        }
    }
    fun ecrireStockage(items: JSONObject) = changementsStockage(stockage.ecrire(items))

    // ---------- Messages du lecteur ----------
    private fun depuisLecteur(data: String, principal: Boolean, proxy: JavaScriptReplyProxy) {
        val env = try { JSONObject(data) } catch (e: Exception) { return }
        // Bonjour du cadre principal = nouvelle page : les cadres de la page précédente n'existent plus.
        if (env.optString("k") == "hello" && principal) nouvellePage()
        val fid = idDe(proxy)
        when (env.optString("k")) {
            "hello" -> { cadres[fid] = proxy; if (principal) ongletChange() }
            "bye" -> { cadres.remove(fid); idsCadres.remove(proxy) }
            "msg" -> {
                cadres[fid] = proxy
                if (env.optString("dir") != "salon") return
                val sender = JSONObject().put("frameId", fid).put("url", env.optString("url")).put("tab", onglet())
                versSalon(JSONObject().put("k", "msg").put("id", env.opt("id")).put("msg", env.opt("msg")).put("sender", sender))
            }
            "reply" -> versSalon(JSONObject().put("k", "reply").put("id", env.opt("id")).put("value", env.opt("value")).put("none", env.optBoolean("none")))
            "call" -> {
                val id = env.opt("id"); val fn = env.optString("fn")
                if (fn !in APPELS_LECTEUR) { versCadre(proxy, JSONObject().put("k", "ret").put("id", id).put("error", "refusé")); return }
                val demandees = env.optJSONObject("args")?.optJSONArray("keys")
                val cles = (0 until (demandees?.length() ?: 0)).map { demandees!!.optString(it) }.filter { it in CLES_LECTEUR }
                versCadre(proxy, JSONObject().put("k", "ret").put("id", id).put("value", stockage.lire(cles)))
            }
        }
    }

    // ---------- Messages du salon ----------
    private fun depuisSalon(data: String, proxy: JavaScriptReplyProxy) {
        val env = try { JSONObject(data) } catch (e: Exception) { return }
        when (env.optString("k")) {
            "hello" -> { salonProxy = proxy; ongletChange() }
            "msg" -> {
                if (env.optString("dir") != "lecteur") return
                val id = env.opt("id")
                val cibles = if (env.has("frameId") && !env.isNull("frameId")) listOfNotNull(cadre(env.optInt("frameId"))) else tousLesCadres()
                versSalon(JSONObject().put("k", "count").put("id", id).put("n", cibles.size))
                val m = JSONObject().put("k", "msg").put("id", id).put("msg", env.opt("msg")).put("sender", JSONObject().put("id", "cowatch-app"))
                for (p in cibles) versCadre(p, m)
            }
            "reply" -> {
                val p = cadre(env.optInt("frameId", -1)) ?: return
                versCadre(p, JSONObject().put("k", "reply").put("id", env.opt("id")).put("value", env.opt("value")).put("none", env.optBoolean("none")))
            }
            "call" -> appel(env.opt("id"), env.optString("fn"), env.optJSONObject("args") ?: JSONObject())
        }
    }

    private fun appel(id: Any?, fn: String, args: JSONObject) {
        val rendre = { v: Any? -> versSalon(JSONObject().put("k", "ret").put("id", id).put("value", v ?: JSONObject.NULL)) }
        when (fn) {
            "storage.get" -> rendre(stockage.lire(args.optJSONArray("keys")?.let { a -> (0 until a.length()).map { a.optString(it) } }))
            "storage.set" -> { ecrireStockage(args.optJSONObject("items") ?: JSONObject()); rendre(null) }
            "storage.remove" -> {
                val a = args.optJSONArray("keys") ?: JSONArray()
                changementsStockage(stockage.effacer((0 until a.length()).map { a.optString(it) })); rendre(null)
            }
            "tab.get" -> rendre(onglet())
            "panel.open" -> { hote.montrerSalon(true); rendre(JSONObject().put("ok", true)) }
            "panel.state" -> rendre(JSONObject().put("open", hote.salonOuvert()))
            "open" -> { hote.ouvrir(args.optString("url")); rendre(null) }
            "clip" -> rendre(JSONObject().put("ok", hote.partager(args.optString("text"), args.optBoolean("share"))))
            "mic.state" -> rendre(JSONObject().put("state", if (hote.microAutorise()) "granted" else "prompt"))
            "mic.ask" -> hote.demanderMicro { ok ->
                rendre(JSONObject().put("granted", ok))
                if (ok) evenement("micGranted")
            }
            "room.state" -> { hote.etatSalon(args); rendre(null) }
            else -> versSalon(JSONObject().put("k", "ret").put("id", id).put("error", "inconnu"))
        }
    }

}
