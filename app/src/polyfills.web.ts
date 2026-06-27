/**
 * Browsers already implement Web Crypto (crypto.getRandomValues), so unlike
 * the native polyfills.ts, react-native-get-random-values isn't needed here
 * (it has no web implementation and would throw if imported).
 */
import { Buffer } from "buffer";

const globalRef = globalThis as unknown as { Buffer?: typeof Buffer };
if (typeof globalRef.Buffer === "undefined") {
  globalRef.Buffer = Buffer;
}
