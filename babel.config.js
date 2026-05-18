module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    // Worklets plugin must be LAST. As of Reanimated 4 it lives in its own package.
    plugins: ['react-native-worklets/plugin'],
  };
};
