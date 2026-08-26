import type { IncomingMessage, ServerResponse } from "http";
import { adminDb, deviceIdForWallet } from "../_lib/firebaseAdmin";
import { walletFromBearer } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Replaces the client's direct Firebase onValue() listener on /meters/{id}
 * (see src/hooks/useMeterData.ts) and its separate walletToDevice read (see
 * src/services/deviceBinding.ts) with one polled endpoint -- the client no
 * longer talks to Firebase directly at all. Returns both "do I have a
 * device paired" and, if so, its current reading in one round trip.
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
    const deviceId = await deviceIdForWallet(walletAddress);
    if (!deviceId) {
      res.status(200).json({ hasDevice: false });
      return;
    }

    const snap = await adminDb().ref(`meters/${deviceId}`).get();
    res.status(200).json({ hasDevice: true, deviceId, reading: snap.exists() ? snap.val() : null });
  } catch (error) {
    console.error("meters/mine failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
