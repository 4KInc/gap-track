const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // Media the probes play. Metro treats unknown extensions as source
    // otherwise, and the require() fails at bundle time.
    assetExts: [...new Set([...defaultConfig.resolver.assetExts, 'mp4', 'wav', 'm4a', 'aac'])],
  },
};

module.exports = mergeConfig(defaultConfig, config);
