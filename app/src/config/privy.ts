import { sepolia } from "@privy-io/chains";

/**
 * Read from EXPO_PUBLIC_PRIVY_APP_ID at build time (Expo inlines any env var
 * prefixed EXPO_PUBLIC_ into the JS bundle automatically -- no extra config),
 * falling back to the same literal eas.json's build profile supplies.
 *
 * The fallback is not belt-and-braces, it is load-bearing. `eas build` reads
 * these from the build profile's `env` block in eas.json; `eas update` does
 * NOT -- it resolves them from the server-side EAS environment, which for
 * this project is empty. An OTA therefore shipped a bundle where this was the
 * empty string, Privy initialised with no app id, and every existing session
 * became invalid: the app logged the household out and then failed every
 * login attempt with "Couldn't reach the login server", recoverable only by
 * reinstalling a real build. BACKEND_URL survived the same update untouched
 * precisely because it already had a literal fallback.
 *
 * These are public client identifiers, not secrets -- they are already in
 * eas.json in plain text -- so hardcoding them here costs nothing and removes
 * a way for the app to silently lose the ability to authenticate.
 */
export const PRIVY_APP_ID =
  process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? "cmqurd9a501040cl47ym5mzpr";

/**
 * Privy apps can have multiple "clients" (Web, Mobile), each with their own
 * allowed origins / app identifiers. The native SDK has to be told which
 * client to validate against via clientId, or it checks against the
 * default client -- which is why adding the native app identifier under the
 * Mobile client alone doesn't fix the "not an allowed app identifier" error
 * without this.
 */
export const PRIVY_MOBILE_CLIENT_ID =
  process.env.EXPO_PUBLIC_PRIVY_MOBILE_CLIENT_ID ??
  "client-WY6aUXfrm42pwKPCD9EQwyNYEdtNf6kfnhcQNqpdCcCw5";

/**
 * Ethereum Sepolia (chainId 11155111) is the only chain this app uses. Privy
 * ships this definition out of the box (@privy-io/chains), so we don't
 * redefine it.
 */
export const privySupportedChains: [typeof sepolia] = [sepolia];
