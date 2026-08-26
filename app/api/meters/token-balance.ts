import type { IncomingMessage, ServerResponse } from "http";
import { adminDb, deviceIdForWallet } from "../_lib/firebaseAdmin";
import { walletFromBearer } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Mirrors the household's spendable ENGY balance into Firebase so the
 * physical meter can show it locally and gate relays on it -- server-side
 * replacement for src/services/budget.ts's setMeterTokenBalance(). Called
 * by the dashboard after every on-chain balance refresh; best-effort on the
 * client side (a missed write just leaves the meter's figure stale until
 * the next one).
 */
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
    const { spendableWh } = (body ?? {}) as { spendableWh?: number };
    if (typeof spendableWh !== "number" || !Number.isFinite(spendableWh) || spendableWh < 0) {
      res.status(400).json({ error: "spendableWh must be a non-negative number" });
      return;
    }

    const deviceId = await deviceIdForWallet(walletAddress);
    if (!deviceId) {
      res.status(404).json({ error: "No device paired to this wallet" });
      return;
    }

    await adminDb().ref(`meters/${deviceId}/tokenBalance`).set(spendableWh);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("meters/token-balance failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
