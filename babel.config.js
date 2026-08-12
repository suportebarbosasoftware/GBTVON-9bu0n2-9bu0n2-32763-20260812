module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          // Ensure Flow types are stripped before Hermes parses the file.
          // This prevents "invalid expression" errors on Flow-annotated
          // React Native core files (e.g. AppRegistry.js) with hermes-parser.
          reanimated: true,
        },
      ],
    ],
    plugins: [
      'react-native-reanimated/plugin',
    ],
  };
}
