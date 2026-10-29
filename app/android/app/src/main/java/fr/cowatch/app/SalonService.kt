package fr.cowatch.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Notification du salon (service de premier plan). Elle garde la voix ouverte quand l'écran s'éteint
 * et offre « Micro » et « Quitter ». Démarrée seulement quand on entre dans un salon, appli à l'écran
 * (règle d'Android 14 pour le micro).
 */
class SalonService : Service() {
    companion object {
        private const val CANAL = "salon"
        private const val ID = 7
        private const val MAJ = "fr.cowatch.app.MAJ"
        private const val MICRO = "fr.cowatch.app.MICRO"
        private const val QUITTER = "fr.cowatch.app.QUITTER"
        /** Branché par MainActivity : « mute » ou « leave », transmis à l'écran du salon. */
        var surAction: ((String) -> Unit)? = null

        fun maj(ctx: Context, code: String, coupe: Boolean, nombre: Int) {
            val i = Intent(ctx, SalonService::class.java).setAction(MAJ)
                .putExtra("code", code).putExtra("coupe", coupe).putExtra("nombre", nombre)
            try { ContextCompat.startForegroundService(ctx, i) } catch (e: Exception) { /* hors premier plan : pas de notification */ }
        }
        fun arreter(ctx: Context) { ctx.stopService(Intent(ctx, SalonService::class.java)) }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            MICRO -> { surAction?.invoke("mute"); return START_NOT_STICKY }
            QUITTER -> { surAction?.invoke("leave"); return START_NOT_STICKY }
        }
        val code = intent?.getStringExtra("code") ?: ""
        val coupe = intent?.getBooleanExtra("coupe", false) ?: false
        val nombre = intent?.getIntExtra("nombre", 1) ?: 1
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CANAL, getString(R.string.canal_salon), NotificationManager.IMPORTANCE_LOW).apply {
            description = getString(R.string.canal_salon_desc); setShowBadge(false)
        })
        val flagsPI = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val ouvrir = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), flagsPI)
        val micro = PendingIntent.getService(this, 1, Intent(this, SalonService::class.java).setAction(MICRO), flagsPI)
        val quitter = PendingIntent.getService(this, 2, Intent(this, SalonService::class.java).setAction(QUITTER), flagsPI)
        val notif = NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(getString(R.string.notif_titre, code))
            .setContentText(getString(if (coupe) R.string.notif_micro_coupe else R.string.notif_micro_ouvert, nombre))
            .setContentIntent(ouvrir)
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .addAction(0, getString(R.string.notif_micro), micro)
            .addAction(0, getString(R.string.notif_quitter), quitter)
            .build()
        val avecMicro = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val type = if (avecMicro) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        try {
            ServiceCompat.startForeground(this, ID, notif, type)
        } catch (e: Exception) {
            try { ServiceCompat.startForeground(this, ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) } catch (e2: Exception) { stopSelf() }
        }
        return START_NOT_STICKY
    }
}
