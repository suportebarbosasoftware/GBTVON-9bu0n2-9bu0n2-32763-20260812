package com.gbtvon.streaming

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.graphics.drawable.StateListDrawable
import android.util.AttributeSet
import android.view.KeyEvent
import android.widget.FrameLayout
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter

/**
 * TVFocusableView — Native Android focusable container for GBTVON
 *
 * Uses StateListDrawable as foreground to show the red focus border.
 * This is the standard Android TV mechanism: the OS itself switches
 * states when focus enters/leaves — zero JS roundtrip, zero Canvas
 * custom drawing, zero invalidate() calls. It just works on every
 * Android TV, TV Box, Fire TV, and Google TV device.
 *
 * The foreground drawable is drawn ON TOP of all child views by the
 * Android framework automatically. No overriding draw() needed.
 */
class TVFocusableView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

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

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        clipChildren = false
        clipToPadding = false
        // Block inner Pressable/View from stealing focus
        descendantFocusability = FOCUS_BLOCK_DESCENDANTS

        // ── Build the focus foreground using StateListDrawable ──────────────
        //
        // Focused state: two-layer drawable
        //   Layer 0 — wide semi-transparent red stroke (glow)
        //   Layer 1 — sharp red stroke (border)
        //
        // Normal state: fully transparent (invisible)

        val cornerRadius = 18f

        // Glow ring (wider, low alpha)
        val glowDrawable = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            this.cornerRadius = cornerRadius + 4f
            setStroke(28, Color.argb(60, 229, 0, 0))
            setColor(Color.TRANSPARENT)
        }

        // Sharp red border
        val borderDrawable = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            this.cornerRadius = cornerRadius
            setStroke(5, Color.parseColor("#E50000"))
            setColor(Color.TRANSPARENT)
        }

        val focusedLayer = LayerDrawable(arrayOf(glowDrawable, borderDrawable))

        val stateList = StateListDrawable()
        // focused state must be added BEFORE the default empty state
        stateList.addState(intArrayOf(android.R.attr.state_focused), focusedLayer)
        stateList.addState(intArrayOf(), ColorDrawable(Color.TRANSPARENT))

        // foreground is drawn by the framework ABOVE all children — no draw() override needed
        foreground = stateList
    }

    // ── Focus: notify JS for application logic only ──────────────────────────
    // The visual is already handled by the StateListDrawable above.

    override fun onFocusChanged(
        gainFocus: Boolean,
        direction: Int,
        previouslyFocusedRect: android.graphics.Rect?
    ) {
        super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)

        val reactContext = context as? ReactContext ?: return
        val event = if (gainFocus) "topNativeFocus" else "topNativeBlur"
        reactContext
            .getJSModule(RCTEventEmitter::class.java)
            ?.receiveEvent(id, event, null)
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
