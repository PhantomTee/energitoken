import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Removes a wallet's device pairing in both directions. Client can no longer
 * write deviceToWallet/walletToDevice directly (locked to admin-only after
 * the earlier security audit -- see database.rules.json), so unbinding has
 * to go through here, same pattern as claim.ts.
 *
 * Only removes the pairing the caller's OWN wallet is currently in -- looks
 * up walletToDevice/{walletAddress} first and only touches that specific
 * deviceId, so this can't be used to unbind an arbitrary device someone
 * else is using.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { walletAddress } = (body ?? {}) as { walletAddress?: string };

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: "walletAddress must be a valid 0x address" });
      return;
    }

    const db = adminDb();
    const deviceSnap = await db.ref(`walletToDevice/${walletAddress}`).get();
    if (!deviceSnap.exists()) {
      res.status(404).json({ error: "This wallet has no device paired" });
      return;
    }
    const deviceId: string = deviceSnap.val();

    await db.ref().update({
      [`walletToDevice/${walletAddress}`]: null,
      [`deviceToWallet/${deviceId}`]: null,
    });

    res.status(200).json({ ok: true, deviceId });
  } catch (error) {
    console.error("devices/unbind failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
