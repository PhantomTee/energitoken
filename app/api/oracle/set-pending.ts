import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";
import { setPendingBurnEngy } from "../_lib/setPendingBurn";
import { verifyMeterSignature } from "../_lib/meterHmac";
import { withOracleLock } from "../_lib/oracleLock";
import { getSpendableBalanceServer } from "../_lib/engyReads";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

type DevicePendingResult =
  | { deviceId: string; ok: true; pendingWh: number; txHash: string }
  | { deviceId: string; ok: true; pendingWh: number; skipped: true; reason: string }
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

    try {
      // energyWhInt (not the display-only float energyWh) is what's signed --
      // see meterHmac.ts for why an integer field avoids float-formatting
      // mismatches between the firmware's C++ and this verification.
      const meterSnap = await db.ref(`meters/${deviceId}`).get();
      if (!meterSnap.exists()) {
        return { deviceId, ok: false, error: "No meter reading found for device" };
      }
      const meter = meterSnap.val() as { energyWhInt?: number; sig?: string; energyScale?: string };
      if (meter.energyWhInt === undefined) {
        return { deviceId, ok: false, error: "Meter reading missing signed energyWhInt (firmware needs updating)" };
      }
      if (!verifyMeterSignature(deviceId, meter.energyWhInt, meter.sig)) {
        return { deviceId, ok: false, error: "Invalid meter signature -- refusing to set pendingBurn against an unverified reading" };
      }
      const currentEnergyWh: number = meter.energyWhInt;

      // The whole checkpoint node, not just lastBurnedWh, so the energy
      // scale can be compared -- see the matching guard in oracle/burn.ts.
      const checkpointSnap = await db.ref(`burnCheckpoints/${deviceId}`).get();
      const checkpoint = (checkpointSnap.val() ?? {}) as { lastBurnedWh?: number; energyScale?: string };
      const lastBurnedWh: number = checkpoint.lastBurnedWh ?? 0;

      // Same scale guard burn.ts applies, and it matters more here because
      // this job runs FIRST in the workflow. A checkpoint still carrying the
      // old cycle-scale meaning (or no checkpoint at all) against a meter
      // now reporting its lifetime total would make that entire lifetime
      // figure look pending -- and pendingBurn is exactly what gates
      // transfers, so the household would find their whole balance
      // unspendable until the burn step rebaselined moments later. Leave
      // pendingBurn untouched for the single run that takes.
      const meterScale: string = meter.energyScale ?? "cycle";
      const checkpointScale: string = checkpoint.energyScale ?? "cycle";
      if (meterScale !== checkpointScale) {
        return {
          deviceId,
          ok: true,
          pendingWh: 0,
          skipped: true,
          reason: `Meter energy scale changed (${checkpointScale} -> ${meterScale}) — deferring to oracle/burn to rebaseline`,
        };
      }

      // Clamp to 0 rather than sending a negative amount on-chain -- a meter
      // reset between burns will show up here as a negative raw delta; the
      // next hourly burn run rebaselines the checkpoint properly.
      const pendingWh = Math.max(0, Math.floor(currentEnergyWh - lastBurnedWh));

      const txHash = await setPendingBurnEngy(walletAddress, pendingWh);
      return { deviceId, ok: true, pendingWh, txHash };
    } finally {
      // Re-assert this household's spendable balance on the meter node on
      // EVERY exit path above -- success, an early bail-out for a missing or
      // unsigned reading, or a thrown transaction. This is the self-healing
      // floor under the instant path in oracle/transfer-webhook.ts: that
      // webhook is what makes a recipient's meter beep within seconds of an
      // incoming transfer, but if a delivery is missed, the endpoint is
      // briefly down, or the webhook is misconfigured at the provider,
      // nothing else server-side refreshed tokenBalance at all. The only
      // other writer is the app's own setMeterTokenBalance, which needs the
      // household's phone open on Dashboard/Budget/Transfer -- and even then
      // re-mirrors only every 2 minutes. A physical meter's credit must not
      // depend on somebody having the app in the foreground.
      //
      // In a `finally` rather than inline for two reasons. It has to run for
      // devices that bail out early (a meter with no signed reading yet still
      // needs its credit current -- the firmware's zero-balance gate cuts
      // every relay while tokenBalance is unknown or <= 0, so a stale mirror
      // is the difference between a household having power and not). And it
      // has to run AFTER setPendingBurnEngy, not before: spendableBalanceOf
      // is balanceOf minus the on-chain pendingBurn this call just rewrote,
      // so mirroring first would publish a figure that over-states available
      // credit by a whole tick's unsettled consumption -- the unsafe
      // direction, letting a household spend energy it hasn't paid for.
      await mirrorSpendableBalance(db, deviceId, walletAddress);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("oracle/set-pending: device processing failed", { deviceId, error: message });
    return { deviceId, ok: false, error: message };
  }
}

/**
 * Writes the wallet's live spendable balance to the meter node the firmware
 * polls (every FB_PULL_MS, currently 2s), so an incoming transfer reaches the
 * physical meter without the recipient's app being involved at all.
 *
 * Spendable, not raw balanceOf, to match every other writer of this field
 * (the client's setMeterTokenBalance and transfer-webhook.ts) -- the meter
 * must gate on credit that isn't already spoken for by consumption the
 * oracle hasn't burned yet, or a household could spend the same ENGY twice.
 *
 * Never throws: this is a best-effort backstop running inside a bulk loop
 * over every paired device, and a single wallet's RPC hiccup must not fail
 * that wallet's pendingBurn result -- let alone the other devices behind it
 * in the loop. Logged and swallowed; the next tick re-asserts it anyway.
 */
async function mirrorSpendableBalance(
  db: ReturnType<typeof adminDb>,
  deviceId: string,
  walletAddress: string
): Promise<void> {
  try {
    const spendable = await getSpendableBalanceServer(walletAddress);
    await db.ref(`meters/${deviceId}/tokenBalance`).set(Number(spendable));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("oracle/set-pending: balance mirror failed", { deviceId, error: message });
  }
}
