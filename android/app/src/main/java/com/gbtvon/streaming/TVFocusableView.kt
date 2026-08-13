package com.gbtvon.streaming

import android.content.Context
import android.util.AttributeSet
import android.view.KeyEvent
import android.widget.FrameLayout
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter

/**
 * TVFocusableView — Native Android focusable container for GBTVON
 *
 * A FrameLayout that:
 *  - Is natively focusable (D-Pad / remote control moves focus here)
 *  - Reports focus gain/loss to React Native via RCT events
 *  - Reports click (OK / center button) via RCT event
 *  - Clips nothing so the red border/glow can bleed outside
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
        // Allow child views and decorations (border, shadow) to draw outside bounds
        clipChildren = false
        clipToPadding = false
        descendantFocusability = FOCUS_BLOCK_DESCENDANTS
    }

    override fun onFocusChanged(gainFocus: Boolean, direction: Int, previouslyFocusedRect: android.graphics.Rect?) {
        super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
        val reactContext = context as? ReactContext ?: return
        val event = if (gainFocus) "topNativeFocus" else "topNativeBlur"
        reactContext
            .getJSModule(RCTEventEmitter::class.java)
            ?.receiveEvent(id, event, null)
    }

    override fun performClick(): Boolean {
        super.performClick()
        val reactContext = context as? ReactContext ?: return true
        reactContext
            .getJSModule(RCTEventEmitter::class.java)
            ?.receiveEvent(id, "topNativePress", null)
        return true
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // DPAD_CENTER and BUTTON_A trigger click
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_BUTTON_A || keyCode == KeyEvent.KEYCODE_ENTER) {
            performClick()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    /** Called by the manager to request focus after layout */
    fun requestFocusDelayed() {
        post {
            requestFocus()
        }
    }
}
