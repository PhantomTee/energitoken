import type { IncomingMessage, ServerResponse } from "http";
import { randomBytes } from "crypto";
import { createPayment } from "../_lib/flutterwaveClient";
import { ordersRef } from "../_lib/firebaseAdmin";
import { walletFromBearer } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

// Crude per-wallet rate limit: refuse a new order within this many ms of
// the wallet's last one. Not a proper token-bucket/sliding-window limiter
// (that needs a shared store like Redis, which this deployment doesn't
// have), but it stops the specific abuse this endpoint was open to --
// an unauthenticated caller spamming Flutterwave order creation in a tight
// loop -- for negligible extra Firebase read cost.
const MIN_INTERVAL_BETWEEN_ORDERS_MS = 3_000;

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

  // The wallet is derived from a verified session token, not trusted from
  // the request body -- this endpoint used to accept any wallet address
  // from a fully unauthenticated request, letting anyone create real
  // Flutterwave payment orders on another wallet's behalf with no session
  // at all.
  let walletAddress: string;
  try {
    walletAddress = walletFromBearer(req.headers.authorization as string | undefined);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Unauthorized" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { amountNgn, email } = (body ?? {}) as {
      amountNgn?: unknown;
      email?: unknown;
    };

    // ── Rate limit ──────────────────────────────────────────────────────
    const rateLimitRef = ordersRef().parent!.child(`orderRateLimits/${walletAddress}`);
    const lastOrderAt = (await rateLimitRef.get()).val() as number | null;
    if (lastOrderAt && Date.now() - lastOrderAt < MIN_INTERVAL_BETWEEN_ORDERS_MS) {
      res.status(429).json({ error: "Too many requests -- please wait a moment before trying again." });
      return;
    }
    await rateLimitRef.set(Date.now());

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

    // Persist the order BEFORE calling Flutterwave, not after. Calling
    // Flutterwave first meant a successful checkout-link creation followed
    // by a failed Firebase write left an orphaned Flutterwave transaction
    // with no local order for callback.ts to ever match against -- the
    // customer could complete a real payment that would never mint.
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

    let link: string;
    try {
      ({ link } = await createPayment({
        txRef,
        amountNgn,
        redirectUrl,
        customerEmail: typeof email === "string" ? email : undefined,
      }));
    } catch (err) {
      // Mark the order dead rather than leaving it stuck in "initial"
      // forever with no checkout link anyone could ever complete.
      await ordersRef().child(txRef).update({ status: "failed", updatedAt: Date.now() });
      throw err;
    }

    await ordersRef().child(txRef).update({ updatedAt: Date.now() });

    res.status(200).json({ reference: txRef, checkoutUrl: link });
  } catch (error) {
    console.error("payments/create failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
