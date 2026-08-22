package com.gbtvon.streaming

import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.view.KeyEvent
import android.view.View
import android.view.ViewTreeObserver
import kotlin.math.cos
import kotlin.math.sin

/**
 * The application's single Android-TV focus indicator.
 *
 * React Native already lets Android choose the next focusable View when the
 * user presses the D-pad.  This drawable observes that native choice and
 * paints above the whole Activity, so it also covers plain Pressables that do
 * not use a special React component.  It never receives focus or touch input.
 */
class TVFocusIndicator(private val decorView: View) : Drawable(),
    ViewTreeObserver.OnGlobalFocusChangeListener,
    View.OnLayoutChangeListener,
    ViewTreeObserver.OnPreDrawListener {

    private val density = decorView.resources.displayMetrics.density
    private val targetRect = RectF()
    private val lastTargetRect = RectF()
    private val viewLocation = IntArray(2)
    private val decorLocation = IntArray(2)
    private val starPath = Path()
    private var target: View? = null
    private var remoteNavigationSeen = isTelevisionDevice()
    private var disposed = false

    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 12f * density
        color = Color.argb(110, 46, 168, 255)
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f * density
        color = Color.parseColor("#2EA8FF")
    }
    private val starPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.WHITE
    }

    init {
        decorView.overlay.add(this)
        decorView.addOnLayoutChangeListener(this)
        addObservers()
        updateBounds()
        if (remoteNavigationSeen) {
            decorView.post { updateTarget(decorView.rootView.findFocus()) }
        }
    }

    /** Called by MainActivity before Android dispatches D-pad navigation. */
    fun onKeyEvent(event: KeyEvent) {
        if (event.action != KeyEvent.ACTION_DOWN || !isRemoteNavigationKey(event.keyCode)) return
        remoteNavigationSeen = true
        // The focused View changes while the event is dispatched. Posting
        // covers a first press that does not produce a focus-change callback.
        decorView.post { updateTarget(decorView.rootView.findFocus()) }
    }

    override fun onGlobalFocusChanged(oldFocus: View?, newFocus: View?) {
        if (remoteNavigationSeen) updateTarget(newFocus)
    }

    override fun onPreDraw(): Boolean {
        if (remoteNavigationSeen && target != null) updateTarget(target)
        return true
    }

    override fun onLayoutChange(
        v: View, left: Int, top: Int, right: Int, bottom: Int,
        oldLeft: Int, oldTop: Int, oldRight: Int, oldBottom: Int
    ) {
        updateBounds()
        updateTarget(target)
    }

    override fun draw(canvas: Canvas) {
        if (target == null || targetRect.isEmpty()) return

        val radius = 10f * density
        canvas.drawRoundRect(targetRect, radius, radius, glowPaint)
        canvas.drawRoundRect(targetRect, radius, radius, borderPaint)
        drawStar(
            canvas,
            targetRect.right - 10f * density,
            targetRect.top + 10f * density,
            9f * density,
            4f * density
        )
    }

    override fun setAlpha(alpha: Int) {
        glowPaint.alpha = (110 * alpha) / 255
        borderPaint.alpha = alpha
        starPaint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {
        glowPaint.colorFilter = colorFilter
        borderPaint.colorFilter = colorFilter
        starPaint.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = android.graphics.PixelFormat.TRANSLUCENT

    fun dispose() {
        if (disposed) return
        disposed = true
        removeObservers()
        decorView.removeOnLayoutChangeListener(this)
        decorView.overlay.remove(this)
        target = null
    }

    private fun updateTarget(candidate: View?) {
        if (disposed) return
        if (candidate == null || candidate === decorView || !candidate.isShown || !candidate.isFocusable) {
            if (target != null) {
                target = null
                targetRect.setEmpty()
                lastTargetRect.setEmpty()
                invalidateSelf()
            }
            return
        }

        candidate.getLocationInWindow(viewLocation)
        decorView.getLocationInWindow(decorLocation)
        val left = viewLocation[0] - decorLocation[0] + 2f * density
        val top = viewLocation[1] - decorLocation[1] + 2f * density
        val right = left + candidate.width - 4f * density
        val bottom = top + candidate.height - 4f * density
        if (right <= left || bottom <= top) return

        target = candidate
        targetRect.set(left, top, right, bottom)
        if (targetRect != lastTargetRect) {
            lastTargetRect.set(targetRect)
            invalidateSelf()
        }
    }

    private fun updateBounds() {
        setBounds(0, 0, decorView.width, decorView.height)
    }

    private fun addObservers() {
        val observer = decorView.viewTreeObserver
        if (observer.isAlive) {
            observer.addOnGlobalFocusChangeListener(this)
            observer.addOnPreDrawListener(this)
        }
    }

    private fun removeObservers() {
        val observer = decorView.viewTreeObserver
        if (observer.isAlive) {
            observer.removeOnGlobalFocusChangeListener(this)
            observer.removeOnPreDrawListener(this)
        }
    }

    private fun isTelevisionDevice(): Boolean {
        val uiMode = decorView.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK
        val packageManager = decorView.context.packageManager
        return uiMode == Configuration.UI_MODE_TYPE_TELEVISION ||
            packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    }

    private fun isRemoteNavigationKey(keyCode: Int): Boolean = keyCode == KeyEvent.KEYCODE_DPAD_UP ||
        keyCode == KeyEvent.KEYCODE_DPAD_DOWN ||
        keyCode == KeyEvent.KEYCODE_DPAD_LEFT ||
        keyCode == KeyEvent.KEYCODE_DPAD_RIGHT ||
        keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
        keyCode == KeyEvent.KEYCODE_ENTER ||
        keyCode == KeyEvent.KEYCODE_BUTTON_A

    private fun drawStar(canvas: Canvas, cx: Float, cy: Float, outerRadius: Float, innerRadius: Float) {
        starPath.reset()
        val points = 8
        val step = Math.PI / points
        for (index in 0 until points * 2) {
            val angle = index * step - Math.PI / 2.0
            val radius = if (index % 2 == 0) outerRadius else innerRadius
            val x = (cx + radius * cos(angle)).toFloat()
            val y = (cy + radius * sin(angle)).toFloat()
            if (index == 0) starPath.moveTo(x, y) else starPath.lineTo(x, y)
        }
        starPath.close()
        canvas.drawPath(starPath, starPaint)
    }
}
