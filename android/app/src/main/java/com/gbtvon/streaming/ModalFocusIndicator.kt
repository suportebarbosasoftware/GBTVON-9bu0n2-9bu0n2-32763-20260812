package com.gbtvon.streaming

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.view.View
import android.view.ViewTreeObserver
import java.util.WeakHashMap
import kotlin.math.cos
import kotlin.math.sin

/**
 * Draws the same blue TV focus frame inside React Native Modal windows.
 *
 * A React Native Modal owns another Android window, so MainActivity's single
 * TVFocusIndicator cannot paint above it. This helper is attached only to the
 * search keyboard controls and observes Android's native focus directly. It
 * does not replace, disable or modify the focus indicator used anywhere else.
 */
class ModalFocusIndicator private constructor(
    private val target: View
) : Drawable(),
    ViewTreeObserver.OnGlobalFocusChangeListener,
    View.OnLayoutChangeListener,
    View.OnAttachStateChangeListener {

    private val density = target.resources.displayMetrics.density
    private val frame = RectF()
    private val starPath = Path()
    private var isFocused = false
    private var observedRoot: View? = null
    private var disposed = false

    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 10f * density
        color = Color.argb(115, 46, 168, 255)
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

    fun attach() {
        target.overlay.add(this)
        target.addOnLayoutChangeListener(this)
        target.addOnAttachStateChangeListener(this)
        observeRoot()
        updateBounds()
        target.post { updateFocus(target.rootView.findFocus()) }
    }

    override fun onGlobalFocusChanged(oldFocus: View?, newFocus: View?) {
        updateFocus(newFocus)
    }

    override fun onLayoutChange(
        view: View, left: Int, top: Int, right: Int, bottom: Int,
        oldLeft: Int, oldTop: Int, oldRight: Int, oldBottom: Int
    ) {
        updateBounds()
    }

    override fun onViewAttachedToWindow(view: View) {
        observeRoot()
        updateBounds()
        view.post { updateFocus(view.rootView.findFocus()) }
    }

    override fun onViewDetachedFromWindow(view: View) {
        dispose()
    }

    override fun draw(canvas: Canvas) {
        if (!isFocused || frame.isEmpty) return
        val radius = 9f * density
        canvas.drawRoundRect(frame, radius, radius, glowPaint)
        canvas.drawRoundRect(frame, radius, radius, borderPaint)
        drawStar(
            canvas,
            frame.right - 10f * density,
            frame.top + 10f * density,
            8f * density,
            3.5f * density
        )
    }

    override fun setAlpha(alpha: Int) {
        glowPaint.alpha = (115 * alpha) / 255
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

    private fun observeRoot() {
        val root = target.rootView
        if (observedRoot === root) return
        removeObserver()
        observedRoot = root
        root.viewTreeObserver.takeIf { it.isAlive }?.addOnGlobalFocusChangeListener(this)
    }

    private fun updateFocus(newFocus: View?) {
        if (disposed) return
        val focused = newFocus === target
        if (isFocused == focused) return
        isFocused = focused
        invalidateSelf()
    }

    private fun updateBounds() {
        frame.set(
            3f * density,
            3f * density,
            (target.width - 3f * density).coerceAtLeast(0f),
            (target.height - 3f * density).coerceAtLeast(0f)
        )
        setBounds(0, 0, target.width, target.height)
        invalidateSelf()
    }

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

    private fun dispose() {
        if (disposed) return
        disposed = true
        removeObserver()
        target.removeOnLayoutChangeListener(this)
        target.removeOnAttachStateChangeListener(this)
        target.overlay.remove(this)
        attachedIndicators.remove(target)
    }

    private fun removeObserver() {
        observedRoot?.viewTreeObserver?.takeIf { it.isAlive }
            ?.removeOnGlobalFocusChangeListener(this)
        observedRoot = null
    }

    companion object {
        private val attachedIndicators = WeakHashMap<View, ModalFocusIndicator>()

        fun attachTo(view: View) {
            if (attachedIndicators.containsKey(view)) return
            ModalFocusIndicator(view).also { indicator ->
                attachedIndicators[view] = indicator
                indicator.attach()
            }
        }
    }
}
