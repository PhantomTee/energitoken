import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";
import { walletFromBearer } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Latest 50 in-app notifications for the caller's wallet -- server-side
 * replacement for src/hooks/useNotifications.ts's onValue() listener.
 * Polled by the client instead of pushed in realtime.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "GET") {
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
    const snap = await adminDb()
      .ref(`notifications/${walletAddress}`)
      .orderByChild("createdAt")
      .limitToLast(50)
      .get();

    const items: Array<{ id: string; type: string; title: string; body: string; read: boolean; createdAt: number }> = [];
    snap.forEach((child) => {
      const value = child.val();
      items.push({
        id: child.key as string,
        type: value.type ?? "topup",
        title: value.title ?? "",
        body: value.body ?? "",
        read: !!value.read,
        createdAt: value.createdAt ?? 0,
      });
      return false;
    });
    items.sort((a, b) => b.createdAt - a.createdAt);

    res.status(200).json({ notifications: items });
  } catch (error) {
    console.error("notifications/list failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
