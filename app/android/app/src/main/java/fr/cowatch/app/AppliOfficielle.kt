package fr.cowatch.app

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/** Une appli officielle connue (assets/www/applis.json). */
class Appli(val id: String, val nom: String, val paquets: List<String>)

/**
 * « Mode A » : Cowatch lit et commande le lecteur de l'appli officielle (Netflix, Canal+, Crunchyroll…), avec l'accord de
 * l'utilisateur (« accès aux notifications » d'Android). C'est le mécanisme public des télécommandes Bluetooth, des montres
 * et des widgets « lecture en cours » : MediaSessionManager.getActiveSessions + MediaController.TransportControls.
 *
 * Ce que Cowatch fait avec cet accès : lire l'état du lecteur (lecture / pause / position / durée / titre) d'une appli de la
 * liste, et lui envoyer lecture, pause et « aller à ». Rien d'autre : aucune notification n'est lue (EcouteNotifications est
 * vide), aucune appli hors liste n'est commandée (si une autre appli joue, on montre seulement son identifiant).
 */
class AppliOfficielle(private val ctx: Context, val applis: List<Appli>, private val surEtat: (JSONObject) -> Unit) {
    private val msm = ctx.getSystemService(MediaSessionManager::class.java)
    private val ecoute = ComponentName(ctx, EcouteNotifications::class.java)
    private val main = Handler(Looper.getMainLooper())
    private var ctrl: MediaController? = null
    private var inconnue: String? = null
    private var demarre = false

    fun autorise(): Boolean = NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)
    fun appliDe(paquet: String?): Appli? = applis.firstOrNull { paquet != null && paquet in it.paquets }
    fun active(): Boolean = ctrl != null

    private val surSessions = MediaSessionManager.OnActiveSessionsChangedListener { liste -> choisir(liste ?: emptyList()) }
    private val rappel = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = publier()
        override fun onMetadataChanged(metadata: MediaMetadata?) = publier()
        override fun onSessionDestroyed() { lacher(); publier() }
    }

    fun demarrer() {
        if (demarre || !autorise()) { publier(); return }
        try {
            msm.addOnActiveSessionsChangedListener(surSessions, ecoute, main)
            demarre = true
            choisir(msm.getActiveSessions(ecoute))
        } catch (e: SecurityException) { demarre = false; publier() }
    }

    fun arreter() {
        if (demarre) try { msm.removeOnActiveSessionsChangedListener(surSessions) } catch (e: Exception) {}
        demarre = false; lacher()
    }

    /** Parmi les lecteurs actifs, celui d'une appli de la liste : d'abord celui qui joue. */
    private fun choisir(liste: List<MediaController>) {
        val connus = liste.filter { appliDe(it.packageName) != null }
        val choix = connus.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: connus.firstOrNull()
        inconnue = if (choix == null) liste.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }?.packageName else null
        if (choix?.sessionToken != ctrl?.sessionToken) {
            lacher()
            ctrl = choix?.also { it.registerCallback(rappel, main) }
        }
        publier()
    }

    private fun lacher() { ctrl?.unregisterCallback(rappel); ctrl = null }

    /** L'état, avec la position recalculée à cet instant (Android la donne au moment de sa dernière mise à jour). */
    fun etat(): JSONObject {
        val o = JSONObject().put("autorise", autorise()).put("t", System.currentTimeMillis())
        inconnue?.let { o.put("inconnue", it) }
        val c = ctrl ?: return o.put("ok", false).put("etat", "none")
        val app = appliDe(c.packageName)
        val ps = c.playbackState
        val etat = when (ps?.state) {
            PlaybackState.STATE_PLAYING, PlaybackState.STATE_BUFFERING, PlaybackState.STATE_FAST_FORWARDING, PlaybackState.STATE_REWINDING -> "playing"
            PlaybackState.STATE_PAUSED, PlaybackState.STATE_STOPPED, PlaybackState.STATE_CONNECTING -> "paused"
            else -> "none"
        }
        var posMs = ps?.position ?: 0L
        val vitesse = ps?.playbackSpeed?.takeIf { it > 0f } ?: 1f
        if (etat == "playing" && ps != null && ps.lastPositionUpdateTime > 0)
            posMs += ((SystemClock.elapsedRealtime() - ps.lastPositionUpdateTime) * vitesse).toLong()
        val md = c.metadata
        val duree = md?.getLong(MediaMetadata.METADATA_KEY_DURATION)?.takeIf { it > 0 }
        val titre = md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: ""
        return o.put("ok", etat != "none").put("etat", etat).put("app", c.packageName).put("nom", app?.nom ?: c.packageName)
            .put("titre", titre).put("pos", posMs / 1000.0).put("vitesse", vitesse.toDouble())
            .put("duree", duree?.let { it / 1000.0 } ?: JSONObject.NULL)
    }

    private fun publier() { main.post { surEtat(etat()) } }

    // ---------- Commandes (seulement vers l'appli de la liste choisie) ----------
    fun lecture() { ctrl?.transportControls?.play() }
    fun pause() { ctrl?.transportControls?.pause() }
    fun allerA(ms: Long) { ctrl?.transportControls?.seekTo(ms.coerceAtLeast(0L)) }
}
