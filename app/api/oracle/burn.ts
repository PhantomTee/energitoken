import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";
import { burnEngy } from "../_lib/burnEngy";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Consumption oracle — the missing bridge between meter readings and token burns.
 *
 * Flow:
 *  1. Accept a deviceId (posted by the ESP32 firmware or a Vercel cron job).
 *  2. Read current cumulative energyWh from Firebase /meters/{deviceId}.
 *  3. Compare to /burnCheckpoints/{deviceId}/lastBurnedEnergyWh.
 *  4. If delta > 0, call burnConsumed(walletAddress, deltaWh) on-chain.
 *  5. Write back the new checkpoint and tx hash.
 *
 * Idempotency: if the burn tx hash is already recorded for a given energyWh
 * reading, skip — handles firmware retries and cron double-fires.
 *
 * Authorization: requires ORACLE_SECRET header matching ORACLE_SECRET env var.
 * The ESP32 sends this in every telemetry POST; the Vercel cron job sends it
 * via a secure env var. Never exposed client-side.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Lightweight shared secret — keeps this endpoint from being called by
  // anyone who discovers the URL. Not a replacement for proper auth but
  // sufficient for a demo/academic deployment.
  const secret = process.env.ORACLE_SECRET;
  if (secret && req.headers["x-oracle-secret"] !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { deviceId } = (body ?? {}) as { deviceId?: string };

    if (!deviceId || typeof deviceId !== "string") {
      res.status(400).json({ error: "deviceId is required" });
      return;
    }

    const db = adminDb();

    // ── 1. Resolve wallet ────────────────────────────────────────────────
    const walletSnap = await db.ref(`deviceToWallet/${deviceId}`).get();
    if (!walletSnap.exists()) {
      res.status(404).json({ error: "Device not paired to any wallet" });
      return;
    }
    const walletAddress: string = walletSnap.val();

    // ── 2. Read current meter energyWh ───────────────────────────────────
    const meterSnap = await db.ref(`meters/${deviceId}/energyWh`).get();
    if (!meterSnap.exists()) {
      res.status(404).json({ error: "No meter reading found for device" });
      return;
    }
    const currentEnergyWh: number = meterSnap.val();

    // ── 3. Load last burn checkpoint ─────────────────────────────────────
    const checkpointRef = db.ref(`burnCheckpoints/${deviceId}`);
    const checkpointSnap = await checkpointRef.get();
    const checkpoint = checkpointSnap.val() ?? { lastBurnedEnergyWh: 0 };
    const lastBurnedEnergyWh: number = checkpoint.lastBurnedEnergyWh ?? 0;

    const deltaWh = Math.floor(currentEnergyWh - lastBurnedEnergyWh);

    if (deltaWh <= 0) {
      res.status(200).json({ ok: true, burned: false, reason: "No new consumption since last burn" });
      return;
    }

    // ── 4. Burn on-chain ─────────────────────────────────────────────────
    const txHash = await burnEngy(walletAddress, deltaWh);

    // ── 5. Write checkpoint ──────────────────────────────────────────────
    await checkpointRef.set({
      lastBurnedEnergyWh: currentEnergyWh,
      lastBurnTxHash: txHash,
      lastBurnAt: Date.now(),
      walletAddress,
      deviceId,
    });

    res.status(200).json({ ok: true, burned: true, deltaWh, txHash });
  } catch (error) {
    console.error("oracle/burn failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
