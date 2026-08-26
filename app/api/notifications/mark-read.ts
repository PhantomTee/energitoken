import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";
import { walletFromBearer } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/** Marks the given notification ids as read -- server-side replacement for
 * useNotifications.ts's markAllRead(). */
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
    const { ids } = (body ?? {}) as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(200).json({ ok: true });
      return;
    }

    const updates: Record<string, boolean> = {};
    for (const id of ids) {
      if (typeof id === "string" && id) updates[`notifications/${walletAddress}/${id}/read`] = true;
    }
    if (Object.keys(updates).length > 0) {
      await adminDb().ref().update(updates);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("notifications/mark-read failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
