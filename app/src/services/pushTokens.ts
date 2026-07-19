import { ref, set } from "firebase/database";
import { db } from "./firebase";

/** Firebase can't have "." or "/" in keys — Expo push tokens contain both. */
export function encodePushTokenKey(token: string): string {
  return encodeURIComponent(token);
}

/** Registers this device's Expo push token against the wallet, so server
 * functions know where to send push notifications for this account. */
export async function savePushToken(walletAddress: string, expoPushToken: string): Promise<void> {
  const key = encodePushTokenKey(expoPushToken);
  await set(ref(db, `pushTokens/${walletAddress}/${key}`), {
    token: expoPushToken,
    updatedAt: Date.now(),
  });
}
