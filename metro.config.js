const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// ── Safe stub resolver for modules that crash on Android TV ─────────────────
//
// expo-modules-core accesses NativeModules.NativeUnimoduleProxy at module
// evaluation time. On Android TV devices where this native module is not
// properly registered, it throws:
//
//   TypeError: Cannot read property 'NativeModule' of undefined
//
// We intercept these specific modules and replace them with safe stubs
// so the app can boot without crashing on TV.
//
const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Intercept expo-modules-core internal native proxy modules
  if (
    moduleName === 'expo-modules-core/build/NativeModulesProxy.native' ||
    moduleName === 'expo-modules-core/build/NativeModulesProxy' ||
    moduleName === 'expo-modules-core/NativeModulesProxy'
  ) {
    return {
      filePath: path.resolve(__dirname, 'shims/NativeModulesProxy.js'),
      type: 'sourceFile',
    };
  }

  // Always delegate to the standard Metro resolver as fallback
  if (typeof originalResolveRequest === 'function') {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
