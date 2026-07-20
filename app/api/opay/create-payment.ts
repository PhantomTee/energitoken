import type { IncomingMessage, ServerResponse } from "http";
import { randomBytes } from "crypto";
import { createCashierPayment } from "../_lib/opayClient";
import { ordersRef } from "../_lib/firebaseAdmin";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

// Tariff — kept in one place server-side so callback.ts and create-payment.ts
// always agree. Exposed via /api/tariff so the app can render it dynamically.
export const TARIFF = {
  version: process.env.TARIFF_VERSION ?? "1",
  whPerNgn: Number(process.env.WH_PER_NGN ?? "1"),  // 1 Wh per ₦1 placeholder
  minNgn: 100,      // ₦100 minimum top-up
  maxNgn: 100_000,  // ₦100,000 maximum top-up
};

function buildReturnUrls(reference: string) {
  const webUrl = (process.env.PUBLIC_WEB_URL ?? "https://energitoken.vercel.app").replace(/\/$/, "");
  return {
    returnUrl: `${webUrl}/payment-complete?reference=${reference}`,
    cancelUrl:  `${webUrl}/payment-complete?cancelled=true&reference=${reference}`,
  };
}

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
    // Reject fractional naira — OPay works in kobo, avoid rounding surprises.
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

    const reference = `etk_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const whAmount   = Math.floor(amountNgn * TARIFF.whPerNgn);
    const { returnUrl, cancelUrl } = buildReturnUrls(reference);
    const backendUrl = (process.env.PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app").replace(/\/$/, "");
    const callbackUrl = `${backendUrl}/api/opay/callback`;

    const opayResponse = await createCashierPayment({
      reference,
      amountNgn,
      returnUrl,
      cancelUrl,
      callbackUrl,
      userEmail: typeof email === "string" ? email : undefined,
    });

    const now = Date.now();
    await ordersRef().child(reference).set({
      walletAddress,
      amountNgn,
      whAmount,
      status: "initial",
      orderNo: opayResponse.data?.orderNo ?? null,
      // Store tariff snapshot so we can audit any future tariff change impact.
      tariffVersion: TARIFF.version,
      whPerNgn: TARIFF.whPerNgn,
      createdAt: now,
      updatedAt: now,
    });

    res.status(200).json({ reference, cashierUrl: opayResponse.data?.cashierUrl });
  } catch (error) {
    console.error("create-payment failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
