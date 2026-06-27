import { polygonAmoy } from "@privy-io/chains";

/**
 * Read from EXPO_PUBLIC_PRIVY_APP_ID at build time (Expo inlines any env var
 * prefixed EXPO_PUBLIC_ into the JS bundle automatically — no extra config).
 */
export const PRIVY_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Privy apps can have multiple "clients" (Web, Mobile), each with their own
 * allowed origins / app identifiers. The native SDK has to be told which
 * client to validate against via clientId, or it checks against the
 * default client — which is why adding the native app identifier under the
 * Mobile client alone doesn't fix the "not an allowed app identifier" error
 * without this.
 */
export const PRIVY_MOBILE_CLIENT_ID = process.env.EXPO_PUBLIC_PRIVY_MOBILE_CLIENT_ID ?? "";

/**
 * Polygon Amoy (chainId 80002) is the only chain this app uses. Privy ships
 * this definition out of the box (@privy-io/chains), so we don't redefine it.
 */
export const privySupportedChains: [typeof polygonAmoy] = [polygonAmoy];
