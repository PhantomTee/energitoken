import type { IncomingMessage, ServerResponse } from "http";
import { ServerValue } from "firebase-admin/database";
import { adminDb, deviceIdForWallet } from "../_lib/firebaseAdmin";
import { walletFromBearer } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Sets the caller's device budget and starts a new consumption cycle
 * atomically -- server-side replacement for src/services/budget.ts's
 * setBudgetWh(), which used to write directly to Firebase from the client.
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
    const { budgetWh } = (body ?? {}) as { budgetWh?: number };
    if (typeof budgetWh !== "number" || !Number.isFinite(budgetWh) || budgetWh < 0) {
      res.status(400).json({ error: "budgetWh must be a non-negative number" });
      return;
    }

    const deviceId = await deviceIdForWallet(walletAddress);
    if (!deviceId) {
      res.status(404).json({ error: "No device paired to this wallet" });
      return;
    }

    await adminDb().ref(`meters/${deviceId}`).update({
      budgetWh,
      cycleStartedAt: ServerValue.TIMESTAMP,
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("meters/budget failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
