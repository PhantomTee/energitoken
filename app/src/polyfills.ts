/**
 * Privy's underlying crypto/JWT libraries (jose, viem) assume Node's global
 * Buffer and Web Crypto APIs, which React Native doesn't provide natively.
 * Must be imported before anything else in the app.
 */
import { Buffer } from "buffer";
import "react-native-get-random-values";

const globalRef = globalThis as unknown as { Buffer?: typeof Buffer };
if (typeof globalRef.Buffer === "undefined") {
  globalRef.Buffer = Buffer;
}
