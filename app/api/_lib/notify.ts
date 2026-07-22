import { adminDb } from "./firebaseAdmin";

export type NotificationType =
  | "topup"        // Flutterwave payment minted
  | "consumption"  // tokens burned for energy used
  | "shed_warning" // budget threshold crossed (70/85/95%)
  | "transfer"     // credit received from another user
  | "device";      // pairing events

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/**
 * Writes an in-app notification to /notifications/{wallet} AND sends a push
 * notification to every device registered for this wallet (/pushTokens/{wallet},
 * written by app/src/hooks/usePushNotifications.ts). This is what actually puts
 * an alert in the phone's notification bar, even with the app closed.
 *
 * Never throws: a failed notification must not break payments or burns.
 */
export async function sendNotification(
  walletAddress: string,
  notification: { type: NotificationType; title: string; body: string }
): Promise<void> {
  await Promise.all([
    writeInAppNotification(walletAddress, notification),
    sendPushNotification(walletAddress, notification),
  ]);
}

async function writeInAppNotification(
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
    console.error("writeInAppNotification failed", error);
  }
}

async function sendPushNotification(
  walletAddress: string,
  notification: { type: NotificationType; title: string; body: string }
): Promise<void> {
  try {
    const snapshot = await adminDb().ref(`pushTokens/${walletAddress}`).get();
    if (!snapshot.exists()) return;

    const entries = Object.values(snapshot.val() as Record<string, { token: string }>);
    const tokens = entries.map((e) => e.token).filter(Boolean);
    if (tokens.length === 0) return;

    const messages = tokens.map((to) => ({
      to,
      title: notification.title,
      body: notification.body,
      data: { type: notification.type },
      sound: "default" as const,
      priority: "high" as const,
    }));

    // Expo's push API accepts a batch array directly, up to 100 per request.
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      console.error("sendPushNotification: Expo push API returned", response.status);
    }
  } catch (error) {
    console.error("sendPushNotification failed", error);
  }
}
