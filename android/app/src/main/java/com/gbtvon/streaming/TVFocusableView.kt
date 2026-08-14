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

/**
 * TVFocusableView — Native Android focusable container for GBTVON
 *
 * Focus visual strategy (final, reliable):
 *   - onFocusChanged() is called by Android TV system synchronously
 *     when D-Pad moves focus — no JS roundtrip, no timeout.
 *   - hasVisualFocus flag is set immediately inside onFocusChanged().
 *   - invalidate() triggers onDraw() on the SAME frame.
 *   - onDraw(Canvas) paints the red border + star directly on Canvas.
 *
 * Why not StateListDrawable on foreground:
 *   Many TV Box ROMs (MediaTek / Amlogic / Rockchip) have a documented
 *   bug where foreground drawable state is NOT refreshed when focus
 *   changes on a FrameLayout that hosts React Native views. The system
 *   calls onFocusChanged correctly, but the foreground drawable update
 *   path is short-circuited. Drawing directly in onDraw bypasses this
 *   entire subsystem and is guaranteed to work on every device.
 *
 * setWillNotDraw(false) is mandatory — ViewGroup defaults to
 * willNotDraw=true which skips onDraw entirely.
 */
class TVFocusableView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    // ── Visual state — read/written only on the main thread ─────────────────
    private var hasVisualFocus: Boolean = false

    // ── Paint objects — allocated once, reused every draw ───────────────────
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 5f
        color = Color.parseColor("#E50000")
    }

    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 22f
        color = Color.argb(55, 229, 0, 0)
    }

    private val starPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.parseColor("#E50000")
    }

    private val rect = RectF()
    private val starPath = Path()
    private val cornerRadius = 18f

    // ── Props ────────────────────────────────────────────────────────────────

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

    // ── Init ─────────────────────────────────────────────────────────────────

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        clipChildren = false
        clipToPadding = false
        // Allow inner React views to receive touches, but not D-Pad focus
        descendantFocusability = FOCUS_BLOCK_DESCENDANTS
        // CRITICAL: ViewGroup skips onDraw by default — must opt-in
        setWillNotDraw(false)
    }

    // ── Focus: the ONLY source of truth for the visual ───────────────────────
    //
    // Android TV calls this on the UI thread synchronously when D-Pad moves.
    // Setting hasVisualFocus + invalidate() here guarantees the red border
    // appears on the very next frame, before any JS event is processed.

    override fun onFocusChanged(
        gainFocus: Boolean,
        direction: Int,
        previouslyFocusedRect: android.graphics.Rect?
    ) {
        super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)

        // Update visual state immediately — no JS, no Handler, no post()
        hasVisualFocus = gainFocus
        invalidate()

        // Notify JS for application logic ONLY (tab switching, etc.)
        // This runs after invalidate so the visual is never blocked by JS.
        val reactContext = context as? ReactContext ?: return
        val event = if (gainFocus) "topNativeFocus" else "topNativeBlur"
        reactContext
            .getJSModule(RCTEventEmitter::class.java)
            ?.receiveEvent(id, event, null)
    }

    // ── Draw ─────────────────────────────────────────────────────────────────
    //
    // Called on every invalidate(). When hasVisualFocus is false this is a
    // no-op (just calls super). When true, draws the red border + star on top
    // of all children, inside the view bounds.

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        if (!hasVisualFocus) return

        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return

        val half = borderPaint.strokeWidth / 2f
        val glowHalf = glowPaint.strokeWidth / 2f

        // ── Glow ring (wide, semi-transparent — drawn behind the border) ──
        rect.set(glowHalf, glowHalf, w - glowHalf, h - glowHalf)
        canvas.drawRoundRect(rect, cornerRadius + 4f, cornerRadius + 4f, glowPaint)

        // ── Sharp red border ──────────────────────────────────────────────
        rect.set(half, half, w - half, h - half)
        canvas.drawRoundRect(rect, cornerRadius, cornerRadius, borderPaint)

        // ── 8-point star in the top-right corner ─────────────────────────
        drawStar(canvas, w, 0f, 14f, 6f)
    }

    /**
     * Draws an 8-point star centered at (cx, cy).
     * outerR = outer radius, innerR = inner radius.
     */
    private fun drawStar(canvas: Canvas, cx: Float, cy: Float, outerR: Float, innerR: Float) {
        val points = 8
        starPath.reset()
        val angleStep = Math.PI / points
        for (i in 0 until points * 2) {
            val angle = i * angleStep - Math.PI / 2.0
            val r = if (i % 2 == 0) outerR else innerR
            val x = (cx + r * Math.cos(angle)).toFloat()
            val y = (cy + r * Math.sin(angle)).toFloat()
            if (i == 0) starPath.moveTo(x, y) else starPath.lineTo(x, y)
        }
        starPath.close()
        canvas.drawPath(starPath, starPaint)
    }

    // ── Click / key ──────────────────────────────────────────────────────────

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
