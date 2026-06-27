import { ref, get, set } from "firebase/database";
import { db } from "./firebase";

export const DEVICE_CODE_PATTERN = /^[0-9A-Fa-f]{6}$/;

function normalizeDeviceId(deviceId: string): string {
  return deviceId.trim().toUpperCase();
}

/** Looks up the device this wallet is already bound to, or null if none. */
export async function getDeviceForWallet(walletAddress: string): Promise<string | null> {
  const snapshot = await get(ref(db, `walletToDevice/${walletAddress}`));
  return snapshot.exists() ? (snapshot.val() as string) : null;
}

/**
 * Binds a device code to a wallet during onboarding. Checks the claim
 * client-side first for a clear error message; the security rules enforce
 * the same write-once-per-device constraint as a backstop either way.
 */
export async function claimDevice(rawDeviceId: string, walletAddress: string): Promise<void> {
  const deviceId = normalizeDeviceId(rawDeviceId);
  if (!DEVICE_CODE_PATTERN.test(deviceId)) {
    throw new Error("Device code must be 6 hex characters (0-9, A-F).");
  }

  const deviceToWalletRef = ref(db, `deviceToWallet/${deviceId}`);
  const existing = await get(deviceToWalletRef);
  if (existing.exists() && existing.val() !== walletAddress) {
    throw new Error("This device is already linked to another account.");
  }

  await set(deviceToWalletRef, walletAddress);
  await set(ref(db, `walletToDevice/${walletAddress}`), deviceId);
}
