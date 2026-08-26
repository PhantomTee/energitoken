import { ethers } from "ethers";
import { apiRequest } from "./apiClient";

export const DEVICE_CODE_PATTERN = /^[0-9A-Fa-f]{6}$/;

function normalizeDeviceId(deviceId: string): string {
  return deviceId.trim().toUpperCase();
}

/** Looks up the device this wallet is already bound to, or null if none. */
export async function getDeviceForWallet(
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<string | null> {
  const result = await apiRequest<{ hasDevice: boolean; deviceId?: string }>(
    "/api/data?resource=meters",
    walletAddress,
    getSigner
  );
  return result.hasDevice ? (result.deviceId as string) : null;
}

/**
 * Claims a device via the server-side API (/api/devices).
 * The API enforces:
 *   - Device must be in pairing mode (ESP32 setup button held, 1h window)
 *   - Device must not already be claimed by another wallet
 *   - Both Firebase bindings written atomically by Admin SDK
 */
export async function claimDevice(
  rawDeviceId: string,
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<void> {
  const deviceCode = normalizeDeviceId(rawDeviceId);
  if (!DEVICE_CODE_PATTERN.test(deviceCode)) {
    throw new Error("Device code must be 6 hex characters (0-9, A-F).");
  }

  await apiRequest("/api/devices", walletAddress, getSigner, {
    method: "POST",
    body: { action: "claim", deviceCode },
  });
}

/** Removes the caller's device pairing via /api/devices. */
export async function unbindDevice(walletAddress: string, getSigner: () => Promise<ethers.Signer>): Promise<void> {
  await apiRequest("/api/devices", walletAddress, getSigner, { method: "POST", body: { action: "unbind" } });
}
