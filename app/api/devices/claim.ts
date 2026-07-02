import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";
import { sendNotification } from "../_lib/notify";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

const DEVICE_CODE_RE = /^[0-9A-Fa-f]{6}$/;
const PAIRING_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Server-side device pairing — replaces the insecure direct Firebase write.
 *
 * Security improvements over the old client-side flow:
 *  - Only claims devices that are in "pairing mode" (pendingDevices entry
 *    written by the ESP32 firmware during setup, expires after 1 hour).
 *  - Pairing codes are enforced to be unclaimed and within the window.
 *  - Both bindings (deviceToWallet and walletToDevice) are written by the
 *    Admin SDK — the client has no direct Firebase write access to these paths.
 *  - A wallet can only pair to one device (write-once walletToDevice).
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { deviceCode, walletAddress } = (body ?? {}) as {
      deviceCode?: string;
      walletAddress?: string;
    };

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: "walletAddress must be a valid 0x address" });
      return;
    }
    if (!deviceCode || !DEVICE_CODE_RE.test(deviceCode)) {
      res.status(400).json({ error: "deviceCode must be 6 hex characters" });
      return;
    }

    const deviceId = deviceCode.toUpperCase();
    const db = adminDb();
    const now = Date.now();

    // ── Check pairing window ─────────────────────────────────────────────
    // The ESP32 writes /pendingDevices/{deviceId} when the user puts it into
    // setup mode (physical button hold). This entry expires after 1 hour.
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

    // ── Check not already paired to a different wallet ───────────────────
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

    // ── Write both bindings atomically via multi-location update ─────────
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
    console.error("devices/claim failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
