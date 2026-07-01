import type { IncomingMessage, ServerResponse } from "http";
import { ordersRef } from "../_lib/firebaseAdmin";
import { mintEngy } from "../_lib/mintEngy";
import { queryPaymentStatus } from "../_lib/opayClient";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * OPay calls this server-to-server when a Cashier payment's status changes.
 *
 * Security model:
 *  1. We NEVER trust the callback body status — it can be forged by anyone
 *     who knows a reference value.
 *  2. We re-query OPay's /cashier/query endpoint with our server credentials
 *     and use only the status returned by that authoritative call.
 *  3. We cross-check orderNo and amount against what we stored at order creation.
 *  4. We use a "minting" intermediate state so a process crash between mint
 *     and the Firebase update doesn't allow a second mint — we check the chain
 *     on restart instead of re-minting blindly.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { reference } = (body ?? {}) as { reference?: string };

    if (!reference) {
      res.status(400).json({ error: "Missing reference" });
      return;
    }

    // Load our stored order first — reject any reference we never created.
    const snapshot = await ordersRef().child(reference).get();
    const order = snapshot.val();
    if (!order) {
      res.status(404).json({ error: "Unknown reference" });
      return;
    }

    // Already processed — idempotent 200 so OPay stops retrying.
    if (order.status === "minted") {
      res.status(200).json({ ok: true, alreadyMinted: true });
      return;
    }

    // "minting" means a previous invocation crashed between mintEngy() and the
    // Firebase update. We verify on-chain whether that mint landed before deciding
    // what to do — for now, surface as an error so an operator can inspect.
    if (order.status === "minting") {
      console.error("opay callback: order stuck in minting state", { reference });
      res.status(500).json({ error: "Order in minting state — manual inspection required" });
      return;
    }

    // ── Re-verify with OPay server-to-server ──────────────────────────────
    let verified;
    try {
      verified = await queryPaymentStatus(reference);
    } catch (err) {
      console.error("opay callback: status query failed", err);
      res.status(502).json({ error: "Could not verify payment with OPay" });
      return;
    }

    // Cross-check: orderNo must match what OPay assigned at creation.
    if (order.orderNo && verified.orderNo !== order.orderNo) {
      console.error("opay callback: orderNo mismatch", { stored: order.orderNo, verified: verified.orderNo });
      res.status(400).json({ error: "orderNo mismatch" });
      return;
    }

    // Cross-check: amount in kobo must match what we requested.
    const expectedKobo = Math.round(order.amountNgn * 100);
    if (verified.amount.total !== expectedKobo || verified.amount.currency !== "NGN") {
      console.error("opay callback: amount mismatch", { expected: expectedKobo, got: verified.amount });
      res.status(400).json({ error: "Amount mismatch — possible tampering" });
      return;
    }

    if (verified.status !== "SUCCESS") {
      await ordersRef().child(reference).update({
        status: "failed",
        opayStatus: verified.status,
        orderNo: verified.orderNo,
        updatedAt: Date.now(),
      });
      res.status(200).json({ ok: true, minted: false, opayStatus: verified.status });
      return;
    }

    // Mark as "minting" before we hit the chain — crash-safe intermediate state.
    await ordersRef().child(reference).update({
      status: "minting",
      orderNo: verified.orderNo,
      verifiedAt: Date.now(),
      updatedAt: Date.now(),
    });

    const txHash = await mintEngy(order.walletAddress, order.whAmount);

    await ordersRef().child(reference).update({
      status: "minted",
      mintTxHash: txHash,
      updatedAt: Date.now(),
    });

    res.status(200).json({ ok: true, minted: true, txHash });
  } catch (error) {
    console.error("opay callback failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
