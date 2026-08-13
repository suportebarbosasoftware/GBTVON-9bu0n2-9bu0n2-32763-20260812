package com.gbtvon.streaming

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import android.view.KeyEvent
import android.widget.FrameLayout
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import kotlin.math.cos
import kotlin.math.sin

/**
 * TVFocusableView — Native Android focusable container for GBTVON
 *
 * Draws the red focus border + star NATIVELY inside onFocusChanged.
 * No JS roundtrip needed for the visual. The Android focus system is the
 * sole source of truth. JS receives events only for application logic
 * (tab switching, etc.) — never for visual rendering.
 */
class TVFocusableView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    // ── State ────────────────────────────────────────────────────────────────

    private var isFocusedState: Boolean = false

    var isViewFocusable: Boolean = true
        set(value) {
            field = value
            isFocusable = value
            isFocusableInTouchMode = value
            isClickable = value
        }

    var isViewDisabled: Boolean = false
        set(value) {
            field = value
            isFocusable = !value
            isFocusableInTouchMode = !value
            isClickable = !value
        }

    // ── Paints (allocated once, reused) ─────────────────────────────────────

    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#E50000")
        style = Paint.Style.STROKE
        strokeWidth = 5f
    }

    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(55, 229, 0, 0)
        style = Paint.Style.STROKE
        strokeWidth = 14f
    }

    private val starFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#E50000")
        style = Paint.Style.FILL
    }

    private val starBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(200, 18, 18, 18)
        style = Paint.Style.FILL
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        clipChildren = false
        clipToPadding = false
        descendantFocusability = FOCUS_BLOCK_DESCENDANTS
        setWillNotDraw(false) // Required: FrameLayout skips onDraw by default
    }

    // ── Focus ────────────────────────────────────────────────────────────────

    override fun onFocusChanged(
        gainFocus: Boolean,
        direction: Int,
        previouslyFocusedRect: android.graphics.Rect?
    ) {
        super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)

        // Update visual IMMEDIATELY — no JS roundtrip
        isFocusedState = gainFocus
        invalidate()

        // Notify JS for application logic only (tab switching, etc.)
        val reactContext = context as? ReactContext ?: return
        val event = if (gainFocus) "topNativeFocus" else "topNativeBlur"
        reactContext
            .getJSModule(RCTEventEmitter::class.java)
            ?.receiveEvent(id, event, null)
    }

    // ── Drawing ──────────────────────────────────────────────────────────────

    override fun draw(canvas: Canvas) {
        super.draw(canvas)
        if (isFocusedState) {
            drawFocusBorder(canvas)
            drawFocusStar(canvas)
        }
    }

    /**
     * Draws a red rounded border + soft outer glow around the view.
     */
    private fun drawFocusBorder(canvas: Canvas) {
        val r = 20f
        val inset = borderPaint.strokeWidth / 2f
        val rect = RectF(inset, inset, width - inset, height - inset)

        // Outer glow (wider, semi-transparent)
        val glowInset = glowPaint.strokeWidth / 2f
        val glowRect = RectF(glowInset, glowInset, width - glowInset, height - glowInset)
        canvas.drawRoundRect(glowRect, r + 4f, r + 4f, glowPaint)

        // Sharp red border
        canvas.drawRoundRect(rect, r, r, borderPaint)
    }

    /**
     * Draws a small ★ in the top-right corner, on top of everything.
     * The star is pinned outside the top-right corner radius.
     */
    private fun drawFocusStar(canvas: Canvas) {
        val starRadius = 14f       // outer radius of star
        val innerRadius = 6f       // inner radius of star
        val points = 5
        val cx = width - 18f       // center X (near top-right corner)
        val cy = 18f               // center Y

        // Background circle so star is readable on any content
        canvas.drawCircle(cx, cy, starRadius + 3f, starBgPaint)

        // Star path
        val path = Path()
        for (i in 0 until points * 2) {
            val angle = (Math.PI / points * i - Math.PI / 2).toFloat()
            val r = if (i % 2 == 0) starRadius else innerRadius
            val x = cx + r * cos(angle)
            val y = cy + r * sin(angle)
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        path.close()
        canvas.drawPath(path, starFillPaint)
    }

    // ── Click ────────────────────────────────────────────────────────────────

    override fun performClick(): Boolean {
        super.performClick()
        val reactContext = context as? ReactContext ?: return true
        reactContext
            .getJSModule(RCTEventEmitter::class.java)
            ?.receiveEvent(id, "topNativePress", null)
        return true
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
            keyCode == KeyEvent.KEYCODE_BUTTON_A ||
            keyCode == KeyEvent.KEYCODE_ENTER
        ) {
            performClick()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    fun requestFocusDelayed() {
        post { requestFocus() }
    }
}
