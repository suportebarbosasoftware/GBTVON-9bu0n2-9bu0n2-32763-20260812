/**
 * shims/NativeModulesProxy.js
 *
 * Safe stub for expo-modules-core's NativeModulesProxy on Android TV / TV Box
 * where NativeUnimoduleProxy native module is not registered.
 *
 * This shim is injected via metro.config.js resolver to replace the real
 * NativeModulesProxy when the native module is unavailable.
 *
 * The real module does:
 *   const NativeModulesProxy = NativeModules.NativeUnimoduleProxy;
 *   export default { NativeModulesProxy.exportedMethods }
 *
 * If NativeUnimoduleProxy is undefined, it crashes. This shim safely returns
 * an empty object so all dependent modules get a no-op proxy instead of crash.
 */

// Try to load the real proxy; fall back to safe stub if it crashes
let NativeModulesProxy;
try {
  const { NativeModules } = require('react-native');
  const proxy = NativeModules && NativeModules.NativeUnimoduleProxy;
  if (proxy && proxy.exportedMethods) {
    // Real module is available — build proxy the same way expo-modules-core does
    NativeModulesProxy = {};
    const methods = proxy.exportedMethods || {};
    Object.keys(methods).forEach((moduleName) => {
      NativeModulesProxy[moduleName] = {};
      const moduleMethods = methods[moduleName] || [];
      moduleMethods.forEach((method) => {
        const name = typeof method === 'string' ? method : method.name;
        if (name) {
          NativeModulesProxy[moduleName][name] = (...args) => {
            try {
              return proxy.callMethod(moduleName, name, args);
            } catch (e) {
              return null;
            }
          };
        }
      });
    });
  } else {
    throw new Error('NativeUnimoduleProxy unavailable');
  }
} catch (_) {
  // Safe stub: all property accesses return undefined/noop without throwing
  NativeModulesProxy = new Proxy(
    {},
    {
      get: function (_, prop) {
        if (prop === '__esModule') return false;
        if (prop === 'then') return undefined;
        if (prop === Symbol.toPrimitive) return undefined;
        if (prop === Symbol.iterator) return undefined;
        // Return a module stub that also proxies nested property access
        return new Proxy(
          {},
          {
            get: function (__, method) {
              if (method === 'then') return undefined;
              if (method === Symbol.toPrimitive) return undefined;
              return function () { return Promise.resolve(null); };
            },
          }
        );
      },
    }
  );
}

module.exports = NativeModulesProxy;
module.exports.default = NativeModulesProxy;
