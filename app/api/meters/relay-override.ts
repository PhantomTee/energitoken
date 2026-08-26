import type { IncomingMessage, ServerResponse } from "http";
import { adminDb, deviceIdForWallet } from "../_lib/firebaseAdmin";
import { walletFromBearer } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

const VALID_TIERS = new Set(["r1", "r2", "r3", "r4"]);

/**
 * Sets or clears a manual relay override for one tier -- server-side
 * replacement for src/services/relayOverride.ts's setRelayOverride().
 * value: true forces the load on, false forces it off, null clears the
 * override back to "auto" (firmware's own budget-shedding logic decides).
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
    const { tier, value } = (body ?? {}) as { tier?: string; value?: boolean | null };

    if (!tier || !VALID_TIERS.has(tier)) {
      res.status(400).json({ error: "tier must be one of r1, r2, r3, r4" });
      return;
    }
    if (value !== null && typeof value !== "boolean") {
      res.status(400).json({ error: "value must be a boolean or null" });
      return;
    }

    const deviceId = await deviceIdForWallet(walletAddress);
    if (!deviceId) {
      res.status(404).json({ error: "No device paired to this wallet" });
      return;
    }

    const overrideRef = adminDb().ref(`meters/${deviceId}/relayOverrides/${tier}`);
    if (value === null) {
      await overrideRef.remove();
    } else {
      await overrideRef.set(value);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("meters/relay-override failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
