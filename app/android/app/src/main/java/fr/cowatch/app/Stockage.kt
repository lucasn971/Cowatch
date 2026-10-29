package fr.cowatch.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** chrome.storage.local de l'appli : réglages du salon (pseudo, photo, ambiance, invitation en attente), sur le téléphone seulement. */
class Stockage(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("cowatch-stockage", Context.MODE_PRIVATE)

    // Chaque valeur est gardée dans un tableau JSON d'un élément : texte, nombre, booléen, objet ou null passent tous.
    private fun emballer(v: Any?): String = JSONArray().put(v ?: JSONObject.NULL).toString()
    private fun deballer(s: String): Any? = try { JSONArray(s).opt(0) } catch (e: Exception) { null }

    fun lire(cles: List<String>?): JSONObject {
        val out = JSONObject()
        for (k in cles ?: prefs.all.keys.toList()) {
            val brut = prefs.getString(k, null) ?: continue
            out.put(k, deballer(brut) ?: JSONObject.NULL)
        }
        return out
    }

    /** Écrit et rend les changements au format de chrome.storage.onChanged. */
    fun ecrire(items: JSONObject): JSONObject {
        val changes = JSONObject()
        val ed = prefs.edit()
        for (k in items.keys()) {
            val v = items.opt(k)
            val ancien = prefs.getString(k, null)
            ed.putString(k, emballer(v))
            changes.put(k, JSONObject().apply {
                if (ancien != null) put("oldValue", deballer(ancien) ?: JSONObject.NULL)
                put("newValue", v ?: JSONObject.NULL)
            })
        }
        ed.apply()
        return changes
    }

    fun effacer(cles: List<String>): JSONObject {
        val changes = JSONObject()
        val ed = prefs.edit()
        for (k in cles) {
            val ancien = prefs.getString(k, null) ?: continue
            ed.remove(k)
            changes.put(k, JSONObject().put("oldValue", deballer(ancien) ?: JSONObject.NULL))
        }
        ed.apply()
        return changes
    }
}
