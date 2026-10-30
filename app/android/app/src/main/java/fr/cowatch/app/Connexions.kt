package fr.cowatch.app

import android.net.TrafficStats
import android.os.Process
import org.json.JSONArray
import org.json.JSONObject

/**
 * « Où va ta connexion » : ce que l'appli a réellement contacté depuis son ouverture, montré sur l'accueil.
 * Rave mesure, pour lui, ce que chacun de ses kits fait passer par la connexion de l'utilisateur (un compteur d'octets par kit) ;
 * Cowatch fait l'inverse : il montre à l'utilisateur chaque site contacté et le volume envoyé.
 * Rien n'est envoyé nulle part : ce journal reste dans la mémoire du téléphone et disparaît à la fermeture de l'appli.
 */
class Connexions(serveurs: Set<String>) {
    /** Les seules adresses que l'écran du salon a le droit de joindre (le reste est bloqué, voir MainActivity). */
    private val salonAutorise = setOf(HOTE_APP, "fonts.googleapis.com", "fonts.gstatic.com") + serveurs

    private val salon = LinkedHashMap<String, Int>()
    private val sites = LinkedHashMap<String, Int>()
    private val bloques = LinkedHashMap<String, Int>()
    private val debut = System.currentTimeMillis()
    private val envoyeDebut = octets(true)
    private val recuDebut = octets(false)

    companion object {
        const val HOTE_APP = "appassets.androidplatform.net"
        private fun octets(envoi: Boolean): Long {
            val v = if (envoi) TrafficStats.getUidTxBytes(Process.myUid()) else TrafficStats.getUidRxBytes(Process.myUid())
            return if (v == TrafficStats.UNSUPPORTED.toLong()) -1 else v
        }
    }

    /** Requête de l'écran du salon : rend false si elle doit être bloquée. */
    @Synchronized fun salon(host: String?): Boolean {
        val h = host ?: return true // données en ligne (data:, blob:) : rien ne sort
        if (h in salonAutorise) { salon[h] = (salon[h] ?: 0) + 1; return true }
        bloques[h] = (bloques[h] ?: 0) + 1
        return false
    }

    /** Requête de la page du service (le site regardé et ses propres serveurs). */
    @Synchronized fun site(host: String?) {
        val h = host ?: return
        if (h == HOTE_APP) return
        sites[h] = (sites[h] ?: 0) + 1
    }

    private fun liste(m: Map<String, Int>) = JSONArray().apply {
        m.entries.sortedByDescending { it.value }.take(60).forEach { put(JSONObject().put("hote", it.key).put("n", it.value)) }
    }

    @Synchronized fun etat(): JSONObject {
        val e = octets(true); val r = octets(false)
        return JSONObject()
            .put("depuis", debut)
            .put("envoye", if (e < 0 || envoyeDebut < 0) -1 else e - envoyeDebut)
            .put("recu", if (r < 0 || recuDebut < 0) -1 else r - recuDebut)
            .put("salon", liste(salon)).put("sites", liste(sites)).put("bloques", liste(bloques))
            .put("sitesTotal", sites.size)
    }
}
