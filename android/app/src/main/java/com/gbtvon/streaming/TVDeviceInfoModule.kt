package com.gbtvon.streaming

import android.content.pm.PackageManager
import android.content.res.Configuration
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

/**
 * Reports whether this is a remote-driven television device.
 *
 * React Native's Platform.isTV relies only on UiModeManager. Several Android
 * TV Boxes incorrectly publish UI_MODE_TYPE_NORMAL, so we also check Leanback
 * and the absence of touchscreen hardware. Constants are available before the
 * first React render, which lets focus and layout use the same classification.
 */
class TVDeviceInfoModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "TVDeviceInfo"

    override fun getConstants(): Map<String, Any> {
        val uiMode = reactApplicationContext.resources.configuration.uiMode and
            Configuration.UI_MODE_TYPE_MASK
        val packageManager = reactApplicationContext.packageManager
        val isTelevision = uiMode == Configuration.UI_MODE_TYPE_TELEVISION ||
            packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
            !packageManager.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)

        return mapOf("isTelevision" to isTelevision)
    }
}
