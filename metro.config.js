const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const blocked = config.resolver.blockList;
config.resolver.blockList = [
  ...(blocked ? (Array.isArray(blocked) ? blocked : [blocked]) : []),
  /[/\\]\.native-backup[/\\]/,
];

// `.bin` is deliberately NOT in `assetExts`: the 264 MB speech model ships as a
// native resource on both platforms, and adding it back would let a stray
// require() pull the whole model into the JS bundle again.

// Modules are required at first use instead of at bundle evaluation, so a cold
// start only pays for the screen it actually paints.
const { getTransformOptions } = config.transformer;
config.transformer.getTransformOptions = async (...args) => {
  const options = await getTransformOptions(...args);
  return {
    ...options,
    transform: { ...options.transform, inlineRequires: true },
  };
};

module.exports = config;
