package fr.cowatch.app

import android.content.Context
import android.net.Uri
import org.json.JSONObject

/** Un site de la liste blanche (assets/www/sites.json, partagé avec l'accueil et l'iPhone). */
class Site(val id: String, val nom: String, val accueil: String, val domaines: List<String>, val ordinateur: Boolean)

/**
 * Liste blanche : seuls ces sites s'ouvrent dans le lecteur, reçoivent le script de calage, ont droit au pont natif
 * et à la vidéo protégée. Tout le reste part dans le navigateur du téléphone.
 */
class Sites(ctx: Context) {
    val liste: List<Site>
    val serveur: String

    init {
        val o = JSONObject(ctx.assets.open("www/sites.json").bufferedReader().use { it.readText() })
        val arr = o.getJSONArray("sites")
        liste = (0 until arr.length()).map { i ->
            val s = arr.getJSONObject(i)
            val d = s.getJSONArray("domaines")
            Site(
                s.getString("id"), s.getString("nom"), s.getString("accueil"),
                (0 until d.length()).map { d.getString(it).lowercase() },
                s.optString("ua") == "ordinateur",
            )
        }
        serveur = o.optJSONObject("app")?.optString("serveur")?.takeIf { it.isNotBlank() } ?: "https://salon-coche-private.onrender.com"
    }

    fun siteDe(host: String?): Site? {
        val h = host?.lowercase() ?: return null
        return liste.firstOrNull { s -> s.domaines.any { h == it || h.endsWith(".$it") } }
    }

    /** Une page du service, en HTTPS seulement. */
    fun autorise(uri: Uri?): Boolean = uri != null && uri.scheme == "https" && siteDe(uri.host) != null

    /** Règles d'origine pour le pont et l'injection (le domaine et tous ses sous-domaines, en HTTPS). */
    fun reglesOrigine(): Set<String> =
        liste.flatMap { it.domaines }.flatMap { listOf("https://$it", "https://*.$it") }.toSet()

    /** Lien d'invitation : https://<serveur>/j/CODE?u=<page> ou cowatch://j/CODE?u=<page>. Rend (code, page) ou null. */
    fun invitation(uri: Uri?): Pair<String, Uri?>? {
        uri ?: return null
        val serveurHost = Uri.parse(serveur).host
        val code = when {
            uri.scheme == "https" && uri.host == serveurHost && uri.pathSegments.size >= 2 && uri.pathSegments[0] == "j" -> uri.pathSegments[1]
            uri.scheme == "cowatch" && uri.host == "j" && uri.pathSegments.isNotEmpty() -> uri.pathSegments[0]
            else -> return null
        }
        if (!Regex("^[A-Za-z0-9-]{3,24}$").matches(code)) return null
        val page = uri.getQueryParameter("u")?.let { Uri.parse(it) }?.takeIf { autorise(it) }
        return code.uppercase() to page
    }
}
