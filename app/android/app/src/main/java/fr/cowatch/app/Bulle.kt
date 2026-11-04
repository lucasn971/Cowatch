package fr.cowatch.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

/**
 * Mode A : pendant qu'on regarde dans l'appli officielle (Netflix…), le salon Cowatch flotte par-dessus.
 *  - repliée : une petite bulle ronde « C » qu'on déplace du doigt ; un toucher la déplie ;
 *  - dépliée : l'écran du salon (le même, déplacé depuis l'appli : voix, chat, réactions) dans un panneau à droite.
 * Les touchers hors du panneau vont à l'appli officielle (FLAG_NOT_TOUCH_MODAL). Exige l'autorisation « afficher par-dessus ».
 */
class Bulle(private val ctx: Context, private val surOuvrirCowatch: () -> Unit) {
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val d = ctx.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()

    private var bouton: TextView? = null
    private var boutonParams: WindowManager.LayoutParams? = null
    private var panneau: LinearLayout? = null
    private var salon: WebView? = null
    private var parentOrigine: ViewGroup? = null
    private var indexOrigine = 0
    private var paramsOrigine: ViewGroup.LayoutParams? = null

    fun possible() = Settings.canDrawOverlays(ctx)
    fun affichee() = bouton != null

    private fun type() = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY

    /** Le salon quitte l'écran de l'appli et devient une bulle par-dessus les autres applis. */
    @SuppressLint("ClickableViewAccessibility")
    fun montrer(vueSalon: WebView) {
        if (!possible() || bouton != null) return
        salon = vueSalon
        parentOrigine = vueSalon.parent as? ViewGroup
        indexOrigine = parentOrigine?.indexOfChild(vueSalon) ?: 0
        paramsOrigine = vueSalon.layoutParams
        parentOrigine?.removeView(vueSalon)

        val b = TextView(ctx).apply {
            text = "C"; textSize = 22f; gravity = Gravity.CENTER; setTextColor(ctx.getColor(R.color.fond))
            contentDescription = "Salon Cowatch : toucher pour ouvrir"
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(ctx.getColor(R.color.accent)) }
            elevation = 8 * d
        }
        val p = WindowManager.LayoutParams(dp(56), dp(56), type(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT)
            .apply { gravity = Gravity.TOP or Gravity.END; x = dp(12); y = dp(120) }
        // Déplacer la bulle du doigt ; un toucher court la déplie.
        var dx = 0f; var dy = 0f; var x0 = 0; var y0 = 0; var bouge = false
        b.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { dx = e.rawX; dy = e.rawY; x0 = p.x; y0 = p.y; bouge = false; true }
                MotionEvent.ACTION_MOVE -> {
                    val mx = e.rawX - dx; val my = e.rawY - dy
                    if (abs(mx) > dp(6) || abs(my) > dp(6)) bouge = true
                    p.x = x0 - mx.toInt(); p.y = y0 + my.toInt()
                    try { wm.updateViewLayout(b, p) } catch (x: Exception) {}
                    true
                }
                MotionEvent.ACTION_UP -> { if (!bouge) deplier(); true }
                else -> false
            }
        }
        try { wm.addView(b, p); bouton = b; boutonParams = p } catch (e: Exception) { rendre() }
    }

    private fun deplier() {
        val s = salon ?: return
        if (panneau != null) return
        bouton?.visibility = View.GONE
        val barre = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(ctx.getColor(R.color.fond))
        }
        fun lien(t: String, desc: String, action: () -> Unit) = TextView(ctx).apply {
            text = t; contentDescription = desc; textSize = 14f; setTextColor(ctx.getColor(R.color.texte))
            setPadding(dp(12), dp(10), dp(12), dp(10)); setOnClickListener { action() }
        }
        barre.addView(lien("▾ Réduire", "Réduire le salon en bulle") { replier() }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        barre.addView(lien("Ouvrir Cowatch", "Revenir dans l'appli Cowatch") { surOuvrirCowatch() })
        val pan = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(ctx.getColor(R.color.fond)); elevation = 12 * d
            addView(barre, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(s, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        val m = ctx.resources.displayMetrics
        val paysage = m.widthPixels > m.heightPixels
        val largeur = minOf(dp(340), (m.widthPixels * if (paysage) 0.42 else 0.92).toInt())
        val hauteur = (m.heightPixels * if (paysage) 0.92 else 0.6).toInt()
        // Focalisable (pour écrire dans le chat), mais les touchers hors du panneau vont à l'appli officielle.
        val p = WindowManager.LayoutParams(largeur, hauteur, type(),
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH, PixelFormat.TRANSLUCENT)
            .apply { gravity = Gravity.END or Gravity.CENTER_VERTICAL; softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE }
        try { wm.addView(pan, p); panneau = pan } catch (e: Exception) { pan.removeView(s); bouton?.visibility = View.VISIBLE }
    }

    private fun replier() {
        val pan = panneau ?: return
        salon?.let { pan.removeView(it) }
        try { wm.removeView(pan) } catch (e: Exception) {}
        panneau = null
        bouton?.visibility = View.VISIBLE
    }

    /** Retour dans Cowatch : la bulle disparaît, le salon reprend sa place dans l'écran de l'appli. */
    fun cacher() {
        replier()
        bouton?.let { try { wm.removeView(it) } catch (e: Exception) {} }
        bouton = null; boutonParams = null
        rendre()
    }

    private fun rendre() {
        val s = salon ?: return
        (s.parent as? ViewGroup)?.removeView(s)
        parentOrigine?.let { par -> par.addView(s, indexOrigine.coerceAtMost(par.childCount), paramsOrigine ?: FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)) }
        salon = null
    }
}
