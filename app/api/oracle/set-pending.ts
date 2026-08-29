import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";
import { setPendingBurnEngy } from "../_lib/setPendingBurn";
import { verifyMeterSignature } from "../_lib/meterHmac";
import { withOracleLock } from "../_lib/oracleLock";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

type DevicePendingResult =
  | { deviceId: string; ok: true; pendingWh: number; txHash: string }
  | { deviceId: string; ok: false; error: string };

/**
 * Runs every 5 minutes (see .github/workflows/burn-oracle.yml) to keep each
 * device's on-chain pendingBurn current in between the hourly settlement
 * burns -- this is what makes the contract's spendable-balance guard reflect
 * "reality" continuously rather than only once an hour. Sets, doesn't add:
 * each run computes the full unburned total since the last actual burn
 * (/burnCheckpoints/{deviceId}/lastBurnedWh) and overwrites the on-chain
 * figure, so a missed or duplicate run is harmless.
 *
 * Authorization: same fail-closed ORACLE_SECRET header check as
 * /api/oracle/burn.
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
    // Returns the response instead of sending it -- see withOracleLock's own
    // note on why responding inside the callback wedged the lock.
    const outcome = await withOracleLock(async (): Promise<{ status: number; body: unknown }> => {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { deviceId } = (body ?? {}) as { deviceId?: string };

      const db = adminDb();

      if (deviceId) {
        const result = await processDevice(db, deviceId);
        if ("error" in result) {
          return {
            status: result.error === "Device not paired to any wallet" || result.error === "No meter reading found for device" ? 404 : 500,
            body: result,
          };
        }
        return { status: 200, body: result };
      }

      const deviceMapSnap = await db.ref("deviceToWallet").get();
      const deviceIds = deviceMapSnap.exists() ? Object.keys(deviceMapSnap.val() as Record<string, string>) : [];

      const results: DevicePendingResult[] = [];
      for (const id of deviceIds) {
        results.push(await processDevice(db, id));
      }

      return { status: 200, body: { ok: true, processed: results.length, results } };
    });

    if (!outcome.ok) {
      res.status(423).json({ error: "Another oracle run is already in progress. Try again shortly." });
      return;
    }
    res.status(outcome.result.status).json(outcome.result.body);
  } catch (error) {
    console.error("oracle/set-pending failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}

async function processDevice(db: ReturnType<typeof adminDb>, deviceId: string): Promise<DevicePendingResult> {
  try {
    const walletSnap = await db.ref(`deviceToWallet/${deviceId}`).get();
    if (!walletSnap.exists()) {
      return { deviceId, ok: false, error: "Device not paired to any wallet" };
    }
    const walletAddress: string = walletSnap.val();

    // energyWhInt (not the display-only float energyWh) is what's signed --
    // see meterHmac.ts for why an integer field avoids float-formatting
    // mismatches between the firmware's C++ and this verification.
    const meterSnap = await db.ref(`meters/${deviceId}`).get();
    if (!meterSnap.exists()) {
      return { deviceId, ok: false, error: "No meter reading found for device" };
    }
    const meter = meterSnap.val() as { energyWhInt?: number; sig?: string };
    if (meter.energyWhInt === undefined) {
      return { deviceId, ok: false, error: "Meter reading missing signed energyWhInt (firmware needs updating)" };
    }
    if (!verifyMeterSignature(deviceId, meter.energyWhInt, meter.sig)) {
      return { deviceId, ok: false, error: "Invalid meter signature -- refusing to set pendingBurn against an unverified reading" };
    }
    const currentEnergyWh: number = meter.energyWhInt;

    const checkpointSnap = await db.ref(`burnCheckpoints/${deviceId}/lastBurnedWh`).get();
    const lastBurnedWh: number = checkpointSnap.exists() ? checkpointSnap.val() : 0;

    // Clamp to 0 rather than sending a negative amount on-chain -- a meter
    // reset between burns will show up here as a negative raw delta; the
    // next hourly burn run rebaselines the checkpoint properly.
    const pendingWh = Math.max(0, Math.floor(currentEnergyWh - lastBurnedWh));

    const txHash = await setPendingBurnEngy(walletAddress, pendingWh);
    return { deviceId, ok: true, pendingWh, txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("oracle/set-pending: device processing failed", { deviceId, error: message });
    return { deviceId, ok: false, error: message };
  }
}
