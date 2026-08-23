package com.gbtvon.streaming

import android.content.pm.PackageManager
import android.content.res.Configuration
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

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

    init {
        activeModule = this
    }

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

    @ReactMethod
    fun setFocusIndicatorEnabled(enabled: Boolean) {
        val activity = currentActivity as? MainActivity ?: return
        activity.runOnUiThread { activity.setFocusIndicatorEnabled(enabled) }
    }

    @ReactMethod
    fun setKeepScreenOn(enabled: Boolean) {
        val activity = currentActivity as? MainActivity ?: return
        activity.runOnUiThread { activity.setKeepScreenOn(enabled) }
    }

    @ReactMethod
    fun setPlayerRemoteKeysEnabled(enabled: Boolean) {
        val activity = currentActivity as? MainActivity ?: return
        activity.runOnUiThread { activity.setPlayerRemoteKeysEnabled(enabled) }
    }

    /**
     * Android's secure SSAID is tied to this device, Android user and app
     * signing certificate. Unlike AsyncStorage, it remains available after
     * the user removes and reinstalls the same signed APK.
     */
    @ReactMethod
    fun getAndroidId(promise: Promise) {
        try {
            val androidId = Settings.Secure.getString(
                reactApplicationContext.contentResolver,
                Settings.Secure.ANDROID_ID
            )
            if (androidId.isNullOrBlank()) promise.resolve(null)
            else promise.resolve(androidId)
        } catch (error: Exception) {
            promise.reject("ANDROID_ID_UNAVAILABLE", "Não foi possível ler o identificador do Android", error)
        }
    }

    private fun emitRemoteKey(keyCode: Int) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("GBTVRemoteKey", keyCode)
    }

    companion object {
        @Volatile
        private var activeModule: TVDeviceInfoModule? = null

        fun emitRemoteKey(keyCode: Int) {
            try {
                activeModule?.emitRemoteKey(keyCode)
            } catch (_: Exception) {
                // The React bridge may be shutting down while Activity closes.
            }
        }
    }
}
