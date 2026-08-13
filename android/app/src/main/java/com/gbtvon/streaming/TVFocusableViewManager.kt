package com.gbtvon.streaming

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * TVFocusableViewManager — exposes TVFocusableView to React Native as "TVFocusableView"
 *
 * Props:
 *   focusable         (Boolean) — whether the view participates in D-Pad focus
 *   disabled          (Boolean) — disables focus and press
 *   hasTVPreferredFocus (Boolean) — requests focus on mount
 *
 * Events mapped to JS:
 *   topNativeFocus  → onNativeFocus
 *   topNativeBlur   → onNativeBlur
 *   topNativePress  → onNativePress
 */
class TVFocusableViewManager : SimpleViewManager<TVFocusableView>() {

    override fun getName(): String = "TVFocusableView"

    override fun createViewInstance(reactContext: ThemedReactContext): TVFocusableView {
        return TVFocusableView(reactContext)
    }

    @ReactProp(name = "focusable", defaultBoolean = true)
    fun setFocusable(view: TVFocusableView, focusable: Boolean) {
        view.isViewFocusable = focusable
    }

    @ReactProp(name = "disabled", defaultBoolean = false)
    fun setDisabled(view: TVFocusableView, disabled: Boolean) {
        view.isViewDisabled = disabled
    }

    @ReactProp(name = "hasTVPreferredFocus", defaultBoolean = false)
    fun setHasTVPreferredFocus(view: TVFocusableView, hasFocus: Boolean) {
        if (hasFocus) {
            view.requestFocusDelayed()
        }
    }

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
        return MapBuilder.builder<String, Any>()
            .put("topNativeFocus",  MapBuilder.of("registrationName", "onNativeFocus"))
            .put("topNativeBlur",   MapBuilder.of("registrationName", "onNativeBlur"))
            .put("topNativePress",  MapBuilder.of("registrationName", "onNativePress"))
            .build()
    }
}
