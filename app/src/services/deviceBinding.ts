import { Platform } from "react-native";
import { ref, get } from "firebase/database";
import { db, auth } from "./firebase";

const BACKEND_URL = Platform.OS === "web" ? "" : process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app";

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
 * The server derives which wallet is calling from this token (see
 * app/api/_lib/firebaseAdmin.ts's walletFromAuthHeader) rather than trusting
 * a walletAddress in the request body -- ensureFirebaseSession must have
 * already run (via the caller's own screen mount / useMeterData) so a
 * binding exists for the current anonymous session before this is called.
 */
async function authHeader(): Promise<Record<string, string>> {
  if (!auth.currentUser) throw new Error("No active session — try again in a moment.");
  const idToken = await auth.currentUser.getIdToken();
  return { Authorization: `Bearer ${idToken}` };
}

/**
 * Claims a device via the server-side API (/api/devices/claim).
 * The API enforces:
 *   - Device must be in pairing mode (ESP32 setup button held, 1h window)
 *   - Device must not already be claimed by another wallet
 *   - Both Firebase bindings written atomically by Admin SDK
 */
export async function claimDevice(rawDeviceId: string): Promise<void> {
  const deviceCode = normalizeDeviceId(rawDeviceId);
  if (!DEVICE_CODE_PATTERN.test(deviceCode)) {
    throw new Error("Device code must be 6 hex characters (0-9, A-F).");
  }

  const response = await fetch(`${BACKEND_URL}/api/devices/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ deviceCode }),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (json as { error?: string }).error ?? `Device claim failed (${response.status})`
    );
  }
}

/** Removes the caller's device pairing via /api/devices/unbind. */
export async function unbindDevice(): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/devices/unbind`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (json as { error?: string }).error ?? `Unbind failed (${response.status})`
    );
  }
}
