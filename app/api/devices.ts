import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "./_lib/firebaseAdmin";
import { walletFromBearer } from "./_lib/appSession";
import { sendNotification } from "./_lib/notify";
import { processDevice } from "./oracle/burn";
import { withOracleLock } from "./_lib/oracleLock";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

const DEVICE_CODE_RE = /^[0-9A-Fa-f]{6}$/;
const PAIRING_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Combines the old /api/devices/claim and /api/devices/unbind into one
 * function, dispatched by body.action -- Vercel's Hobby plan caps a
 * deployment at 12 Serverless Functions, and this project was well past
 * that after the session-token rewrite added several new endpoints.
 * Consolidating files that have no external caller depending on their
 * exact path (unlike payments/callback.ts, which is a Flutterwave webhook
 * URL, or the oracle/* cron endpoints) is the safe way to claw back
 * headroom.
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

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const { action } = (body ?? {}) as { action?: string };

  if (action === "claim") {
    await handleClaim(req, res, walletAddress);
  } else if (action === "unbind") {
    await handleUnbind(res, walletAddress);
  } else {
    res.status(400).json({ error: "action must be 'claim' or 'unbind'" });
  }
}

/**
 * Server-side device pairing -- replaces the insecure direct Firebase write.
 *
 * Security improvements over the old client-side flow:
 *  - The caller's wallet is derived from a verified session token, not
 *    trusted from the request body -- otherwise anyone racing a device's
 *    pairing window could bind it to a wallet of their choosing with a
 *    single unauthenticated HTTP request.
 *  - Only claims devices that are in "pairing mode" (pendingDevices entry
 *    written by the ESP32 firmware during setup, expires after 1 hour).
 *  - Pairing codes are enforced to be unclaimed and within the window.
 *  - Both bindings (deviceToWallet and walletToDevice) are written by the
 *    Admin SDK -- the client has no direct Firebase write access to these paths.
 *  - A wallet can only pair to one device (write-once walletToDevice).
 *  - The claim itself (pendingDevices/{id}/claimed: false -> true) runs as
 *    a Firebase transaction, not a separate read-then-write -- two devices
 *    claims racing the same code (e.g. two people who saw the same demo
 *    unit's screen) would otherwise both pass the "not yet claimed" check
 *    and both write, with the second write silently overwriting the first
 *    (last-write-wins) even though the first caller's UI reported success.
 */
async function handleClaim(req: Req, res: Res, walletAddress: string): Promise<void> {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { deviceCode } = (body ?? {}) as { deviceCode?: string };

    if (!deviceCode || !DEVICE_CODE_RE.test(deviceCode)) {
      res.status(400).json({ error: "deviceCode must be 6 hex characters" });
      return;
    }

    const deviceId = deviceCode.toUpperCase();
    const db = adminDb();
    const now = Date.now();

    // A wallet can only ever hold one device -- checked before the claim
    // transaction so a wallet that's already paired gets a clear error
    // rather than winning the race and leaving deviceToWallet/walletToDevice
    // pointing at each other inconsistently.
    const existingDeviceSnap = await db.ref(`walletToDevice/${walletAddress}`).get();
    if (existingDeviceSnap.exists() && existingDeviceSnap.val() !== deviceId) {
      res.status(409).json({ error: "Your account is already linked to a different device." });
      return;
    }

    const pendingRef = db.ref(`pendingDevices/${deviceId}`);
    const claimResult = await pendingRef.transaction((current: { createdAt: number; claimed?: boolean } | null) => {
      if (!current) return current; // not in pairing mode -- abort, handled below
      if (current.claimed) return; // already claimed -- abort the transaction
      if (now - current.createdAt > PAIRING_WINDOW_MS) return; // expired -- abort
      return { ...current, claimed: true, claimedAt: now, claimedByWallet: walletAddress };
    });

    if (!claimResult.committed) {
      const snap = await pendingRef.get();
      if (!snap.exists()) {
        res.status(404).json({ error: "Device not in pairing mode. Hold the setup button on the meter." });
        return;
      }
      const pending = snap.val() as { createdAt: number; claimed?: boolean };
      if (pending.claimed) {
        res.status(409).json({ error: "Device already claimed." });
        return;
      }
      res.status(410).json({ error: "Pairing window expired. Press the setup button again." });
      return;
    }

    // The pairing claim transaction above is the real race-closer; this
    // deviceToWallet check just guards against the (rare) case of a device
    // ID being reused/reclaimed for a different wallet than one already
    // bound to it in deviceToWallet from an earlier, unrelated pairing.
    const existingWalletSnap = await db.ref(`deviceToWallet/${deviceId}`).get();
    if (existingWalletSnap.exists() && existingWalletSnap.val() !== walletAddress) {
      // Roll back the claim we just won so the device isn't left stuck
      // "claimed" by a pairing that can't actually complete.
      await pendingRef.update({ claimed: false, claimedAt: null, claimedByWallet: null });
      res.status(409).json({ error: "This device is already linked to another account." });
      return;
    }

    await db.ref().update({
      [`deviceToWallet/${deviceId}`]: walletAddress,
      [`walletToDevice/${walletAddress}`]: deviceId,
    });

    await sendNotification(walletAddress, {
      type: "device",
      title: "Meter linked",
      body: `Device ${deviceId} is now paired with your account. Live readings will appear on your dashboard.`,
    });

    res.status(200).json({ ok: true, deviceId, walletAddress });
  } catch (error) {
    console.error("devices claim failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}

/**
 * Removes a wallet's device pairing in both directions. The wallet to
 * unbind is derived from a verified session token, never trusted from the
 * request body -- otherwise anyone who knows a victim's wallet address
 * (not secret: deviceToWallet is readable by any authenticated session)
 * could unbind their meter as pure griefing, with no credential at all.
 *
 * Also settles the device's outstanding consumption and clears its
 * household-specific state before removing the pairing -- an unbind that
 * only removed the mappings left real problems for whoever pairs the
 * device next: unburned consumption with no wallet to burn it against, and
 * a stale budget/cycle/relay-override state a new household never set.
 */
async function handleUnbind(res: Res, walletAddress: string): Promise<void> {
  try {
    const db = adminDb();
    const deviceSnap = await db.ref(`walletToDevice/${walletAddress}`).get();
    if (!deviceSnap.exists()) {
      res.status(404).json({ error: "This wallet has no device paired" });
      return;
    }
    const deviceId: string = deviceSnap.val();

    // Best-effort final settlement: burn whatever consumption has accrued
    // since the last oracle run, against the wallet that's about to be
    // unbound. If this fails (e.g. an RPC hiccup), unbinding still
    // proceeds -- the scheduled oracle run would otherwise find the device
    // with no deviceToWallet entry and simply skip it forever, silently
    // writing off that consumption rather than settling it.
    //
    // Routed through the same withOracleLock() the burn oracle itself uses
    // -- calling processDevice() directly here used to race a concurrent
    // bulk burn run: both could read the same pre-burn burnCheckpoints
    // value and both call burnEngy() for it, burning the same consumption
    // twice with no way to reconcile it afterward (this function's own
    // unconditional burnCheckpoints wipe below erases the evidence). If the
    // lock is held, settlement is skipped this once, same as any other
    // settlement failure -- not fatal to unbinding itself.
    const settlement = await withOracleLock(() => processDevice(db, deviceId)).catch((err) => {
      console.error("devices unbind: final settlement failed", { deviceId, error: err });
      return null;
    });
    if (settlement && !settlement.ok) {
      console.error("devices unbind: final settlement skipped, another oracle run in progress", { deviceId });
    }

    await db.ref().update({
      [`walletToDevice/${walletAddress}`]: null,
      [`deviceToWallet/${deviceId}`]: null,
      // Clear household-specific meter state so the next pairing (by this
      // wallet or another) starts clean rather than inheriting the old
      // household's budget, over-budget cycle, and manual relay overrides.
      [`meters/${deviceId}/budgetWh`]: null,
      [`meters/${deviceId}/cycleStartedAt`]: null,
      [`meters/${deviceId}/relayOverrides`]: null,
      [`burnCheckpoints/${deviceId}`]: null,
    });

    res.status(200).json({ ok: true, deviceId });
  } catch (error) {
    console.error("devices unbind failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
