import { ref, get } from "firebase/database";
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
 * Claims a device via the server-side API (/api/devices/claim).
 * The API enforces:
 *   - Device must be in pairing mode (ESP32 setup button held, 1h window)
 *   - Device must not already be claimed by another wallet
 *   - Both Firebase bindings written atomically by Admin SDK
 */
export async function claimDevice(rawDeviceId: string, walletAddress: string): Promise<void> {
  const deviceCode = normalizeDeviceId(rawDeviceId);
  if (!DEVICE_CODE_PATTERN.test(deviceCode)) {
    throw new Error("Device code must be 6 hex characters (0-9, A-F).");
  }

  const response = await fetch("/api/devices/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceCode, walletAddress }),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (json as { error?: string }).error ?? `Device claim failed (${response.status})`
    );
  }
}
