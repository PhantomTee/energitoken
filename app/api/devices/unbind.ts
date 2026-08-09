import type { IncomingMessage, ServerResponse } from "http";
import { adminDb, walletFromAuthHeader } from "../_lib/firebaseAdmin";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Removes a wallet's device pairing in both directions. Client can no longer
 * write deviceToWallet/walletToDevice directly (locked to admin-only after
 * the earlier security audit -- see database.rules.json), so unbinding has
 * to go through here, same pattern as claim.ts.
 *
 * The wallet to unbind is derived from a verified Firebase ID token (see
 * walletFromAuthHeader), never trusted from the request body -- otherwise
 * anyone who knows a victim's wallet address (not secret: deviceToWallet is
 * readable by any authenticated session) could unbind their meter as pure
 * griefing, with no credential at all.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let walletAddress: string;
  try {
    walletAddress = await walletFromAuthHeader(req.headers.authorization as string | undefined);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Unauthorized" });
    return;
  }

  try {
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
