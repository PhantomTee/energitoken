import { adminDb } from "./firebaseAdmin";

export type NotificationType =
  | "topup"        // OPay payment minted
  | "consumption"  // tokens burned for energy used
  | "shed_warning" // budget threshold crossed (70/85/95%)
  | "transfer"     // credit received from another user
  | "device";      // pairing events

/**
 * Writes an in-app notification to /notifications/{wallet}. The app subscribes
 * to this path live (see app/src/hooks/useNotifications.ts). Server-only —
 * clients can read and mark-as-read, never create (see database.rules.json).
 *
 * Never throws: a failed notification must not break payments or burns.
 */
export async function sendNotification(
  walletAddress: string,
  notification: { type: NotificationType; title: string; body: string }
): Promise<void> {
  try {
    await adminDb().ref(`notifications/${walletAddress}`).push({
      ...notification,
      read: false,
      createdAt: Date.now(),
    });
  } catch (error) {
    console.error("sendNotification failed", error);
  }
}
