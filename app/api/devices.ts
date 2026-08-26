import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "./_lib/firebaseAdmin";
import { walletFromBearer } from "./_lib/appSession";
import { sendNotification } from "./_lib/notify";

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
 * Server-side device pairing — replaces the insecure direct Firebase write.
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
 *    Admin SDK — the client has no direct Firebase write access to these paths.
 *  - A wallet can only pair to one device (write-once walletToDevice).
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

    const pendingSnap = await db.ref(`pendingDevices/${deviceId}`).get();
    if (!pendingSnap.exists()) {
      res.status(404).json({ error: "Device not in pairing mode. Hold the setup button on the meter." });
      return;
    }

    const pending = pendingSnap.val() as { createdAt: number; claimed?: boolean };
    if (pending.claimed) {
      res.status(409).json({ error: "Device already claimed." });
      return;
    }
    if (now - pending.createdAt > PAIRING_WINDOW_MS) {
      res.status(410).json({ error: "Pairing window expired. Press the setup button again." });
      return;
    }

    const existingWalletSnap = await db.ref(`deviceToWallet/${deviceId}`).get();
    if (existingWalletSnap.exists() && existingWalletSnap.val() !== walletAddress) {
      res.status(409).json({ error: "This device is already linked to another account." });
      return;
    }

    const existingDeviceSnap = await db.ref(`walletToDevice/${walletAddress}`).get();
    if (existingDeviceSnap.exists() && existingDeviceSnap.val() !== deviceId) {
      res.status(409).json({ error: "Your account is already linked to a different device." });
      return;
    }

    await db.ref().update({
      [`deviceToWallet/${deviceId}`]: walletAddress,
      [`walletToDevice/${walletAddress}`]: deviceId,
      [`pendingDevices/${deviceId}/claimed`]: true,
      [`pendingDevices/${deviceId}/claimedAt`]: now,
      [`pendingDevices/${deviceId}/claimedByWallet`]: walletAddress,
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

    await db.ref().update({
      [`walletToDevice/${walletAddress}`]: null,
      [`deviceToWallet/${deviceId}`]: null,
    });

    res.status(200).json({ ok: true, deviceId });
  } catch (error) {
    console.error("devices unbind failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
