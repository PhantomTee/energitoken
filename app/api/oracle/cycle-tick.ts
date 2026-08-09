import type { IncomingMessage, ServerResponse } from "http";
import { ServerValue } from "firebase-admin/database";
import { adminDb } from "../_lib/firebaseAdmin";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

type DeviceTickResult =
  | { deviceId: string; ok: true; ticked: boolean; reason?: string }
  | { deviceId: string; ok: false; error: string };

/**
 * Runs once every 24 hours (see .github/workflows/burn-oracle.yml) and rolls
 * every paired, budgeted device onto a new consumption cycle by rewriting
 * cycleStartedAt. This exists because budgetWh is a DAILY figure written
 * once when a household picks their duration -- nothing else ever changes
 * its value, so firmware that only resets on "budgetWh changed" would only
 * ever get one real day of allowance before shedding down for the rest of
 * the household's chosen period. cycleStartedAt is the dedicated signal:
 * firmware resets its local cycle whenever the value it reads differs from
 * the last one it saw, regardless of whether budgetWh itself moved.
 *
 * The app also writes cycleStartedAt directly (see src/services/budget.ts's
 * setBudgetWh), atomically with budgetWh, so a household changing their plan
 * gets an immediate reset rather than waiting for the next tick here.
 *
 * Authorization: same fail-closed ORACLE_SECRET header check as the other
 * oracle endpoints.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.ORACLE_SECRET;
  if (!secret || req.headers["x-oracle-secret"] !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { deviceId } = (body ?? {}) as { deviceId?: string };

    const db = adminDb();

    if (deviceId) {
      const result = await tickDevice(db, deviceId);
      if (!result.ok) {
        res.status(result.error === "Device not paired to any wallet" ? 404 : 500).json(result);
        return;
      }
      res.status(200).json(result);
      return;
    }

    const deviceMapSnap = await db.ref("deviceToWallet").get();
    const deviceIds = deviceMapSnap.exists() ? Object.keys(deviceMapSnap.val() as Record<string, string>) : [];

    const results: DeviceTickResult[] = [];
    for (const id of deviceIds) {
      results.push(await tickDevice(db, id));
    }

    res.status(200).json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error("oracle/cycle-tick failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}

async function tickDevice(db: ReturnType<typeof adminDb>, deviceId: string): Promise<DeviceTickResult> {
  try {
    const walletSnap = await db.ref(`deviceToWallet/${deviceId}`).get();
    if (!walletSnap.exists()) {
      return { deviceId, ok: false, error: "Device not paired to any wallet" };
    }

    // No point rolling a cycle for a device that has no budget yet -- there's
    // nothing for the firmware to enforce until the household sets one, and
    // that first setBudgetWh() call writes the initial cycleStartedAt anyway.
    const budgetSnap = await db.ref(`meters/${deviceId}/budgetWh`).get();
    if (!budgetSnap.exists() || !(budgetSnap.val() > 0)) {
      return { deviceId, ok: true, ticked: false, reason: "No budget set yet" };
    }

    await db.ref(`meters/${deviceId}/cycleStartedAt`).set(ServerValue.TIMESTAMP);
    return { deviceId, ok: true, ticked: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("oracle/cycle-tick: device tick failed", { deviceId, error: message });
    return { deviceId, ok: false, error: message };
  }
}
