import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";
import { burnEngy } from "../_lib/burnEngy";
import { sendNotification } from "../_lib/notify";
import { verifyMeterSignature } from "../_lib/meterHmac";
import { withOracleLock } from "../_lib/oracleLock";

// Budget thresholds mirrored from the ESP32 load-shedding priorities:
// luxury cut at 70%, optional at 85%, essential at 95%.
const SHED_THRESHOLDS = [
  { pct: 70, label: "Luxury loads switched off" },
  { pct: 85, label: "Optional loads switched off" },
  { pct: 95, label: "Essential loads switched off — critical loads only" },
];

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

type DeviceBurnResult =
  | { deviceId: string; ok: true; burned: boolean; deltaWh?: number; txHash?: string; reason?: string }
  | { deviceId: string; ok: false; error: string };

/**
 * Consumption oracle — the bridge between meter readings and token burns.
 * Called on a schedule (see .github/workflows/burn-oracle.yml) with no
 * deviceId in the body, which processes every paired device in one pass;
 * a specific deviceId can still be passed for manual/one-off use.
 *
 * Per device:
 *  1. Read current cumulative energyWh from Firebase /meters/{deviceId}.
 *  2. Compare to /burnCheckpoints/{deviceId}/lastBurnedWh.
 *  3. If delta > 0, call burnConsumed(walletAddress, deltaWh) on-chain --
 *     this also resets the contract's own pendingBurn[wallet] to zero.
 *  4. Write back the new checkpoint.
 *
 * A negative delta means the meter's cumulative counter was reset (new
 * budget cycle, PZEM replaced, etc.) -- there's no way to know how much of
 * the pre-reset remainder was already reflected in earlier burns, so rather
 * than getting stuck forever (the old bug: a stale high checkpoint blocks
 * every future burn until currentEnergyWh climbs back past it), we log it
 * and rebaseline the checkpoint to the new lower value.
 *
 * Authorization: requires ORACLE_SECRET header matching ORACLE_SECRET env
 * var. Fail-closed: if the env var isn't set, every request is rejected --
 * there is no "secret unset means open" fallback.
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
    const outcome = await withOracleLock(async () => {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { deviceId } = (body ?? {}) as { deviceId?: string };

      const db = adminDb();

      if (deviceId) {
        const result = await processDevice(db, deviceId);
        if ("error" in result) {
          res.status(result.error === "Device not paired to any wallet" || result.error === "No meter reading found for device" ? 404 : 500).json(result);
          return;
        }
        res.status(200).json(result);
        return;
      }

      // Bulk mode: every currently-paired device.
      const deviceMapSnap = await db.ref("deviceToWallet").get();
      const deviceIds = deviceMapSnap.exists() ? Object.keys(deviceMapSnap.val() as Record<string, string>) : [];

      const results: DeviceBurnResult[] = [];
      for (const id of deviceIds) {
        results.push(await processDevice(db, id));
      }

      res.status(200).json({ ok: true, processed: results.length, results });
    });

    if (!outcome.ok) {
      res.status(423).json({ error: "Another oracle run is already in progress. Try again shortly." });
    }
  } catch (error) {
    console.error("oracle/burn failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}

/** Exported so devices.ts's unbind handler can settle a device's
 * outstanding consumption one last time before removing its pairing --
 * see that file for why an unbind that only removed mappings left burns
 * unsettled for a device with no owner to burn against by the next
 * scheduled oracle run. */
export async function processDevice(db: ReturnType<typeof adminDb>, deviceId: string): Promise<DeviceBurnResult> {
  try {
    // ── 1. Resolve wallet ────────────────────────────────────────────────
    const walletSnap = await db.ref(`deviceToWallet/${deviceId}`).get();
    if (!walletSnap.exists()) {
      return { deviceId, ok: false, error: "Device not paired to any wallet" };
    }
    const walletAddress: string = walletSnap.val();

    // ── 2. Read current meter energy, signed by that device's own key ─────
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
      return { deviceId, ok: false, error: "Invalid meter signature -- refusing to burn against an unverified reading" };
    }
    const currentEnergyWh: number = meter.energyWhInt;

    // ── 3. Load last burn checkpoint ─────────────────────────────────────
    const checkpointRef = db.ref(`burnCheckpoints/${deviceId}`);
    const checkpointSnap = await checkpointRef.get();
    const checkpoint = checkpointSnap.val() ?? { lastBurnedWh: 0 };
    const lastBurnedWh: number = checkpoint.lastBurnedWh ?? 0;

    const rawDelta = currentEnergyWh - lastBurnedWh;

    if (rawDelta < 0) {
      // Meter counter went backwards -- a reset, not real negative
      // consumption. Rebaseline so future deltas are computed correctly
      // instead of this checkpoint staying stuck above the new reality forever.
      console.warn("oracle/burn: negative delta, meter counter reset -- rebaselining checkpoint", {
        deviceId,
        lastBurnedWh,
        currentEnergyWh,
      });
      await checkpointRef.set({
        lastBurnedWh: currentEnergyWh,
        lastBurnAt: Date.now(),
        walletAddress,
        deviceId,
        rebaselinedAt: Date.now(),
      });
      // Same mirror as the normal-burn path -- without this, a meter reset
      // would leave the Dashboard badge showing a huge stale "pending"
      // amount computed against the old, now-meaningless baseline.
      await db.ref(`meters/${deviceId}/lastBurnedWh`).set(currentEnergyWh);
      return { deviceId, ok: true, burned: false, reason: "Meter counter reset — checkpoint rebaselined" };
    }

    const deltaWh = Math.floor(rawDelta);
    if (deltaWh <= 0) {
      return { deviceId, ok: true, burned: false, reason: "No new consumption since last burn" };
    }

    // ── 4. Burn on-chain (also resets the contract's pendingBurn[wallet]) ─
    const txHash = await burnEngy(walletAddress, deltaWh);

    // ── 5. Write checkpoint ──────────────────────────────────────────────
    await checkpointRef.set({
      lastBurnedWh: currentEnergyWh,
      lastBurnTxHash: txHash,
      lastBurnAt: Date.now(),
      walletAddress,
      deviceId,
    });

    // Mirrors the same figure into the (client-readable) meters/{deviceId}
    // node -- burnCheckpoints itself stays locked (".read": false in
    // database.rules.json), but the app needs *some* way to compute "how
    // much have I used since the last real burn" for the live pending/
    // settled indicator on Dashboard. This one field is the minimal
    // surface: reading.energyWh - reading.lastBurnedWh, both already part
    // of the same live-polled meter reading.
    await db.ref(`meters/${deviceId}/lastBurnedWh`).set(currentEnergyWh);

    // ── 6. Notify: consumption + any budget thresholds crossed ──────────
    const units = (deltaWh / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
    await sendNotification(walletAddress, {
      type: "consumption",
      title: "Energy used",
      body: `${units} unit${deltaWh === 1000 ? "" : "s"} consumed and settled from your balance.`,
    });

    const budgetSnap = await db.ref(`meters/${deviceId}/budgetWh`).get();
    const budgetWh: number | null = budgetSnap.exists() ? budgetSnap.val() : null;
    if (budgetWh && budgetWh > 0) {
      const prevPct = (lastBurnedWh / budgetWh) * 100;
      const newPct = (currentEnergyWh / budgetWh) * 100;
      for (const threshold of SHED_THRESHOLDS) {
        if (prevPct < threshold.pct && newPct >= threshold.pct) {
          await sendNotification(walletAddress, {
            type: "shed_warning",
            title: `Budget ${threshold.pct}% reached`,
            body: `${threshold.label}. You've used ${Math.floor(newPct)}% of your energy budget.`,
          });
        }
      }
    }

    return { deviceId, ok: true, burned: true, deltaWh, txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("oracle/burn: device processing failed", { deviceId, error: message });
    return { deviceId, ok: false, error: message };
  }
}
