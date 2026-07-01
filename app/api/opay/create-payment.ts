import type { IncomingMessage, ServerResponse } from "http";
import { randomBytes } from "crypto";
import { createCashierPayment } from "../_lib/opayClient";
import { ordersRef } from "../_lib/firebaseAdmin";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Conversion rate from a Naira payment to ENGY (Wh). A flat placeholder for
 * this demo — swap WH_PER_NGN for a real per-kWh tariff when one exists.
 */
const WH_PER_NGN = Number(process.env.WH_PER_NGN ?? "1");

/** Where OPay's hosted Cashier page sends the user's browser back to. */
function buildReturnUrls(reference: string) {
  const webUrl = (process.env.PUBLIC_WEB_URL ?? "https://energitoken.vercel.app").replace(/\/$/, "");
  return {
    returnUrl: `${webUrl}/payment-complete?reference=${reference}`,
    cancelUrl: `${webUrl}/payment-complete?cancelled=true&reference=${reference}`,
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
      walletAddress?: string;
      amountNgn?: number;
      email?: string;
    };

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: "walletAddress must be a valid 0x address" });
      return;
    }
    if (!amountNgn || amountNgn <= 0) {
      res.status(400).json({ error: "amountNgn must be greater than 0" });
      return;
    }

    const reference = `etk_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const whAmount = Math.floor(amountNgn * WH_PER_NGN);
    const { returnUrl, cancelUrl } = buildReturnUrls(reference);
    // Hardcoded fallback ensures OPay's server-side callback always reaches us
    // even if PUBLIC_BACKEND_URL is missing from Vercel env vars.
    const backendUrl = (process.env.PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app").replace(/\/$/, "");
    const callbackUrl = `${backendUrl}/api/opay/callback`;

    const opayResponse = await createCashierPayment({
      reference,
      amountNgn,
      returnUrl,
      cancelUrl,
      callbackUrl,
      userEmail: email,
    });

    const now = Date.now();
    await ordersRef().child(reference).set({
      walletAddress,
      amountNgn,
      whAmount,
      status: "initial",
      orderNo: opayResponse.data?.orderNo ?? null,
      createdAt: now,
      updatedAt: now,
    });

    res.status(200).json({ reference, cashierUrl: opayResponse.data?.cashierUrl });
  } catch (error) {
    console.error("create-payment failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
