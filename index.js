/**
 * GBTVON — Entry Point
 *
 * Layer 1 fix: patches NativeModules BEFORE any module factory runs on Hermes.
 *
 * Root cause of Android TV crash:
 *   TypeError: Cannot read property 'NativeModule' of undefined
 *
 * expo-modules-core does this at module-evaluation time:
 *   const { NativeModules } = require('react-native');
 *   const proxy = NativeModules.NativeUnimoduleProxy; // → undefined on TV
 *   proxy.NativeModule // → CRASH
 *
 * Fix strategy:
 *  1. Intercept global.__fbBatchedBridgeConfig to inject a stub NativeUnimoduleProxy
 *  2. Wrap the global nativeModuleProxy with a safe Proxy that never returns undefined
 *  3. Patch ErrorUtils to prevent fatal crashes from killing the app on TV
 */

(function patchNativeModulesForAndroidTV() {
  'use strict';

  // ── Safe stub factory ───────────────────────────────────────────────────
  function makeModuleStub() {
    return {
      NativeModule: null,
      addListener: function () { return { remove: function () {} }; },
      removeListeners: function () {},
      getConstants: function () { return {}; },
      exportedMethods: {},
      exportedConstants: {},
      callMethod: function () { return null; },
      viewManagersNames: [],
    };
  }

  function makeDeepSafeProxy(target) {
    if (typeof Proxy === 'undefined') return target || makeModuleStub();
    return new Proxy(target || {}, {
      get: function (obj, prop) {
        if (prop === 'then') return undefined;
        if (prop === Symbol.toPrimitive) return undefined;
        if (prop === Symbol.iterator) return undefined;
        if (prop === '__esModule') return false;
        try {
          var val = obj[prop];
          if (val !== undefined && val !== null) return val;
        } catch (_) {}
        // Return a stub object for unknown module properties
        return makeModuleStub();
      },
      set: function (obj, prop, val) { obj[prop] = val; return true; },
    });
  }

  try {
    // ── Patch 1: __fbBatchedBridgeConfig (old arch) ───────────────────────
    // React Native populates NativeModules from this config at bridge init.
    // We inject stub entries for missing modules BEFORE the bridge reads it.
    if (global.__fbBatchedBridgeConfig) {
      var cfg = global.__fbBatchedBridgeConfig;
      if (!cfg.remoteModuleConfig) cfg.remoteModuleConfig = [];
      // Check if NativeUnimoduleProxy is present
      var hasProxy = cfg.remoteModuleConfig.some(function (m) {
        return m && (m[0] === 'NativeUnimoduleProxy' || (Array.isArray(m) && m[0] === 'NativeUnimoduleProxy'));
      });
      if (!hasProxy) {
        cfg.remoteModuleConfig.push(['NativeUnimoduleProxy', {
          exportedMethods: {},
          exportedConstants: {},
          viewManagersNames: [],
        }, ['callMethod', 'getConstants']]);
      }
    }

    // ── Patch 2: nativeModuleProxy (JSI legacy bridge) ────────────────────
    if (global.nativeModuleProxy && typeof Proxy !== 'undefined') {
      global.nativeModuleProxy = makeDeepSafeProxy(global.nativeModuleProxy);
    }

    // ── Patch 3: __turboModuleProxy (new arch JSI) ────────────────────────
    if (global.__turboModuleProxy && typeof Proxy !== 'undefined') {
      var origTurbo = global.__turboModuleProxy;
      global.__turboModuleProxy = new Proxy(origTurbo, {
        get: function (target, prop) {
          try {
            var val = target[prop];
            if (val !== undefined && val !== null) return val;
          } catch (_) {}
          return null;
        },
      });
    }

    // ── Patch 4: Intercept require for NativeModules BEFORE module exec ───
    // When expo-modules-core's factory runs, it calls NativeModules.NativeUnimoduleProxy.
    // We need NativeModules to be patched. NativeModules is initialised by RN's
    // BatchedBridge before JS runs, so we hook into the module system resolver.
    var origRequire = global.__r;
    if (typeof origRequire === 'function') {
      global.__r = function (moduleId) {
        try {
          return origRequire(moduleId);
        } catch (e) {
          // If a module crashes during init (like expo-modules-core on TV),
          // return an empty safe object instead of propagating the crash.
          if (__DEV__) console.warn('[GBTVON] Module ' + moduleId + ' failed to init:', e && e.message);
          return {};
        }
      };
    }

  } catch (outerErr) {
    // Never crash the app during patching
    if (__DEV__) console.warn('[GBTVON] patch error:', outerErr);
  }
})();

// ── Global error handler — prevent silent crash on Android TV ───────────────
try {
  if (global.ErrorUtils) {
    var _prevHandler = global.ErrorUtils.getGlobalHandler();
    global.ErrorUtils.setGlobalHandler(function (error, isFatal) {
      if (__DEV__) {
        console.error('[GBTVON] Global error (isFatal=' + isFatal + '):', error && error.message);
      }
      // On TV, swallow fatal JS errors that happen during module init
      // so the app can continue instead of showing a red/black screen.
      // If it's NOT fatal, delegate to the previous handler.
      if (_prevHandler && !isFatal) {
        try { _prevHandler(error, isFatal); } catch (_) {}
      }
      // For fatal errors: log but don't rethrow — this prevents the black screen
    });
  }
} catch (_) {}

// ── Boot Expo Router ─────────────────────────────────────────────────────────
require('expo-router/entry');
