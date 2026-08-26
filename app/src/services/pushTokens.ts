import { ethers } from "ethers";
import { apiRequest } from "./apiClient";

/** Registers this device's Expo push token against the wallet, via
 * /api/notifications/push-token (server-side, Admin SDK), so server
 * functions know where to send push notifications for this account. */
export async function savePushToken(
  walletAddress: string,
  expoPushToken: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<void> {
  await apiRequest("/api/data", walletAddress, getSigner, {
    method: "POST",
    body: { resource: "notifications", action: "push-token", expoPushToken },
  });
}
