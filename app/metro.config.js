const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/**
 * Some of Privy's dependencies (jose, viem) ship "exports" maps that assume a
 * Node.js runtime when Metro resolves package exports, pulling in node:crypto
 * which doesn't exist in React Native. Disabling package-exports resolution
 * falls back to each package's "main"/"browser" field, which resolves correctly.
 */
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
