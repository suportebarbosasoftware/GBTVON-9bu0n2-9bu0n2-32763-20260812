module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin',
    ],
    overrides: [
      {
        // React Native internal files use Flow types.
        // Strip them explicitly so the Hermes parser never sees raw Flow syntax.
        test: /node_modules[\\/]react-native[\\/]/,
        plugins: ['@babel/plugin-transform-flow-strip-types'],
      },
    ],
  };
};
