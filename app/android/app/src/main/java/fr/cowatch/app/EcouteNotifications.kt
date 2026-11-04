package fr.cowatch.app

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Exigé par Android pour avoir le droit de voir les lecteurs des autres applis (MediaSessionManager.getActiveSessions).
 * Volontairement vide : Cowatch ne lit AUCUNE notification. Seul l'état du lecteur de l'appli vidéo est utilisé (AppliOfficielle).
 */
class EcouteNotifications : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {}
    override fun onNotificationRemoved(sbn: StatusBarNotification?) {}
}
