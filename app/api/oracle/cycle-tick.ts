import type { IncomingMessage, ServerResponse } from "http";
import { ServerValue } from "firebase-admin/database";
import { adminDb } from "../_lib/firebaseAdmin";
import { withOracleLock } from "../_lib/oracleLock";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

type DeviceTickResult =
  | { deviceId: string; ok: true; ticked: boolean; reason?: string }
  | { deviceId: string; ok: false; error: string };

/**
 * Rolls every paired, budgeted device onto a new consumption cycle by
 * rewriting cycleStartedAt, once per real West Africa Time calendar day.
 * This exists because budgetWh is a DAILY figure written once when a
 * household picks their duration -- nothing else ever changes its value, so
 * firmware that only resets on "budgetWh changed" would only ever get one
 * real day of allowance before shedding down for the rest of the
 * household's chosen period. cycleStartedAt is the dedicated signal:
 * firmware resets its local cycle whenever the value it reads differs from
 * the last one it saw, regardless of whether budgetWh itself moved.
 *
 * Gated on the WAT calendar date actually having changed since the last
 * roll (see wasRolledToday below), not on 24 hours having elapsed. This
 * endpoint doesn't actually run "once every 24 hours" -- every job in
 * burn-oracle.yml fires on every workflow trigger, and that workflow's own
 * comment documents GitHub Actions' schedule firing anywhere from every 30
 * minutes to every several hours. An unconditional rewrite here (the old
 * behaviour) meant a lucky run of frequent firings rolled the cycle -- and
 * so cleared every relay override and refilled the shed budget -- far more
 * than once a day, silently giving some households more effective daily
 * allowance than they'd set. The date check makes this correct regardless
 * of how often or irregularly the tick actually fires: at most one real
 * roll per calendar day, landing on whichever firing happens to be the
 * first one after WAT midnight rather than exactly at 00:00, but never
 * more than once.
 *
 * The app also writes cycleStartedAt directly (see src/services/budget.ts's
 * setBudgetWh), atomically with budgetWh, so a household changing their plan
 * gets an immediate reset rather than waiting for the next tick here -- that
 * write is unconditional and correctly so, it's a real user action, not a
 * periodic tick.
 *
 * Authorization: same fail-closed ORACLE_SECRET header check as the other
 * oracle endpoints.
 */
const WAT_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST -- Nigeria's zone, the deployment target

function watDateString(epochMs: number): string {
  return new Date(epochMs + WAT_OFFSET_MS).toISOString().slice(0, 10); // YYYY-MM-DD in WAT
}
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
    const outcome = await withOracleLock(async () => {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { deviceId } = (body ?? {}) as { deviceId?: string };

      const db = adminDb();

      if (deviceId) {
        const result = await tickDevice(db, deviceId);
        if ("error" in result) {
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
    });

    if (!outcome.ok) {
      res.status(423).json({ error: "Another oracle run is already in progress. Try again shortly." });
    }
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

    const cycleSnap = await db.ref(`meters/${deviceId}/cycleStartedAt`).get();
    const lastCycleStartedAt: number = cycleSnap.exists() ? cycleSnap.val() : 0;
    const now = Date.now();
    if (lastCycleStartedAt > 0 && watDateString(lastCycleStartedAt) === watDateString(now)) {
      return { deviceId, ok: true, ticked: false, reason: "Already rolled today (WAT)" };
    }

    await db.ref(`meters/${deviceId}/cycleStartedAt`).set(ServerValue.TIMESTAMP);
    return { deviceId, ok: true, ticked: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("oracle/cycle-tick: device tick failed", { deviceId, error: message });
    return { deviceId, ok: false, error: message };
  }
}
