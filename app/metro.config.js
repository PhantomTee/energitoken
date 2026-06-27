const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/**
 * Some of Privy's dependencies (jose, viem) ship "exports" maps that assume a
 * Node.js runtime when Metro resolves package exports for the native platforms,
 * pulling in node:crypto which doesn't exist in React Native. Disabling
 * package-exports resolution falls back to each package's "main"/"browser"
 * field, which resolves correctly there.
 *
 * On web, the opposite is true: @privy-io/react-auth's "x402/client" subpath
 * import only exists via x402's "exports" map (no matching file at the
 * package root), so package-exports resolution must stay enabled for web.
 *
 * Expo Router's app/ directory require.context pulls in every route file
 * (including .web.tsx variants) into every platform's bundle for the route
 * manifest, even though only one variant ever actually renders per platform.
 * That drags @privy-io/react-auth — and its unresolvable-without-exports
 * "x402/client" subpath — into native bundles too. It's dead code there, so
 * stub it out instead of trying to resolve it for real.
 */
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "x402/client" && platform !== "web") {
    return { type: "empty" };
  }
  const resolverContext = { ...context, unstable_enablePackageExports: platform === "web" };
  return (defaultResolveRequest ?? resolverContext.resolveRequest)(resolverContext, moduleName, platform);
};

module.exports = config;
