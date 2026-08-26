import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";
import { walletFromBearer } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/** Registers this device's Expo push token against the caller's wallet --
 * server-side replacement for src/services/pushTokens.ts's savePushToken(). */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let walletAddress: string;
  try {
    walletAddress = walletFromBearer(req.headers.authorization as string | undefined);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Unauthorized" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { expoPushToken } = (body ?? {}) as { expoPushToken?: string };
    if (!expoPushToken || typeof expoPushToken !== "string") {
      res.status(400).json({ error: "expoPushToken is required" });
      return;
    }

    const key = encodeURIComponent(expoPushToken);
    await adminDb().ref(`pushTokens/${walletAddress}/${key}`).set({
      token: expoPushToken,
      updatedAt: Date.now(),
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("notifications/push-token failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
