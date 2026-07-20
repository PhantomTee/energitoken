import type { IncomingMessage, ServerResponse } from "http";
import { randomBytes } from "crypto";
import { createPayment } from "../_lib/flutterwaveClient";
import { ordersRef } from "../_lib/firebaseAdmin";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

// Tariff — kept in one place server-side so callback.ts and create.ts always
// agree. Exposed via /api/tariff so the app can render it dynamically.
export const TARIFF = {
  version: process.env.TARIFF_VERSION ?? "1",
  whPerNgn: Number(process.env.WH_PER_NGN ?? "1"), // 1 Wh per ₦1 placeholder
  minNgn: 100, // ₦100 minimum top-up
  maxNgn: 100_000, // ₦100,000 maximum top-up
};

export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { walletAddress, amountNgn, email } = (body ?? {}) as {
      walletAddress?: unknown;
      amountNgn?: unknown;
      email?: unknown;
    };

    // ── Validate wallet ───────────────────────────────────────────────────
    if (typeof walletAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: "walletAddress must be a valid 0x address" });
      return;
    }

    // ── Validate amount ───────────────────────────────────────────────────
    if (typeof amountNgn !== "number" || !Number.isFinite(amountNgn)) {
      res.status(400).json({ error: "amountNgn must be a number" });
      return;
    }
    if (!Number.isInteger(amountNgn)) {
      res.status(400).json({ error: "amountNgn must be a whole number (no fractions)" });
      return;
    }
    if (amountNgn < TARIFF.minNgn) {
      res.status(400).json({ error: `Minimum top-up is ₦${TARIFF.minNgn.toLocaleString()}` });
      return;
    }
    if (amountNgn > TARIFF.maxNgn) {
      res.status(400).json({ error: `Maximum top-up is ₦${TARIFF.maxNgn.toLocaleString()}` });
      return;
    }

    // 16 random bytes (128 bits) of entropy, prefixed with a timestamp only
    // for rough chronological sortability in the Firebase console -- not
    // relied on for uniqueness or unguessability.
    const txRef = `etk_${Date.now()}_${randomBytes(16).toString("hex")}`;
    const whAmount = Math.floor(amountNgn * TARIFF.whPerNgn);
    const webUrl = (process.env.PUBLIC_WEB_URL ?? "https://energitoken.vercel.app").replace(/\/$/, "");
    const redirectUrl = `${webUrl}/payment-complete`;

    const { link } = await createPayment({
      txRef,
      amountNgn,
      redirectUrl,
      customerEmail: typeof email === "string" ? email : undefined,
    });

    const now = Date.now();
    await ordersRef().child(txRef).set({
      walletAddress,
      amountNgn,
      whAmount,
      status: "initial",
      // Store tariff snapshot so we can audit any future tariff change impact.
      tariffVersion: TARIFF.version,
      whPerNgn: TARIFF.whPerNgn,
      createdAt: now,
      updatedAt: now,
    });

    res.status(200).json({ reference: txRef, checkoutUrl: link });
  } catch (error) {
    console.error("payments/create failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
