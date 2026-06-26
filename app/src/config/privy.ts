import { polygonAmoy } from "@privy-io/chains";

/**
 * Read from EXPO_PUBLIC_PRIVY_APP_ID at build time (Expo inlines any env var
 * prefixed EXPO_PUBLIC_ into the JS bundle automatically — no extra config).
 */
export const PRIVY_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Polygon Amoy (chainId 80002) is the only chain this app uses. Privy ships
 * this definition out of the box (@privy-io/chains), so we don't redefine it.
 */
export const privySupportedChains: [typeof polygonAmoy] = [polygonAmoy];
