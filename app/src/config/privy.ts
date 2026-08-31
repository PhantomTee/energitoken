import { sepolia } from "@privy-io/chains";

/**
 * Read from EXPO_PUBLIC_PRIVY_APP_ID at build time (Expo inlines any env var
 * prefixed EXPO_PUBLIC_ into the JS bundle automatically -- no extra config).
 */
export const PRIVY_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Privy apps can have multiple "clients" (Web, Mobile), each with their own
 * allowed origins / app identifiers. The native SDK has to be told which
 * client to validate against via clientId, or it checks against the
 * default client -- which is why adding the native app identifier under the
 * Mobile client alone doesn't fix the "not an allowed app identifier" error
 * without this.
 */
export const PRIVY_MOBILE_CLIENT_ID = process.env.EXPO_PUBLIC_PRIVY_MOBILE_CLIENT_ID ?? "";

/**
 * Ethereum Sepolia (chainId 11155111) is the only chain this app uses. Privy
 * ships this definition out of the box (@privy-io/chains), so we don't
 * redefine it.
 *
 * Migrated from Polygon Amoy on 2026-08-31: Amoy's faucets had become
 * unobtainable without an existing mainnet balance, leaving the oracle
 * wallet with about nine transactions of gas and no way to refill it.
 */
export const privySupportedChains: [typeof sepolia] = [sepolia];
