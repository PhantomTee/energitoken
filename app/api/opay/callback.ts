import type { IncomingMessage, ServerResponse } from "http";
import { ordersRef } from "../_lib/firebaseAdmin";
import { mintEngy } from "../_lib/mintEngy";
import { queryPaymentStatus, verifyCallbackSignature, getOpaySecretConfig, OPayCallbackPayload } from "../_lib/opayClient";
import { sendNotification } from "../_lib/notify";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * OPay calls this server-to-server when a Cashier payment's status changes.
 *
 * Security model:
 *  1. Verify the callback's own HMAC-SHA3-512 signature first (OPay's
 *     documented mechanism) -- rejects obviously forged requests cheaply,
 *     before touching Firebase or OPay's API.
 *  2. We still NEVER trust the callback body's status for the mint decision
 *     -- we re-query OPay's /cashier/status endpoint with our server
 *     credentials and use only the status returned by that authoritative
 *     call. The signature check is defense-in-depth, not a replacement.
 *  3. We cross-check orderNo and amount against what we stored at order creation.
 *  4. We use a "minting" intermediate state so a process crash between mint
 *     and the Firebase update doesn't allow a second mint.
 *  5. If the mint transaction itself fails, the order is marked "mint_failed"
 *     (not left stuck in "minting" forever) so it's visibly distinguishable
 *     and retriable by an operator.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { payload, sha512 } = (body ?? {}) as { payload?: OPayCallbackPayload; sha512?: string };

    if (!payload?.reference) {
      res.status(400).json({ error: "Missing payload.reference" });
      return;
    }

    if (sha512) {
      // Only verify when a signature is present -- OPay's sandbox callback
      // format has been observed to vary; a present-but-invalid signature is
      // rejected, but we don't hard-fail requests OPay didn't sign at all,
      // since queryPaymentStatus() below is still the authoritative check.
      const { secretKey } = getOpaySecretConfig();
      if (!verifyCallbackSignature(payload, sha512, secretKey)) {
        console.error("opay callback: signature verification failed", { reference: payload.reference });
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const reference = payload.reference;

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

    let txHash: string;
    try {
      txHash = await mintEngy(order.walletAddress, order.whAmount);
    } catch (err) {
      // Don't leave the order stuck in "minting" forever -- mark it
      // distinctly so an operator can see it needs a manual retry, and so
      // it doesn't silently block re-processing if OPay retries the callback.
      const message = err instanceof Error ? err.message : "Unknown mint error";
      console.error("opay callback: mint failed", { reference, error: message });
      await ordersRef().child(reference).update({
        status: "mint_failed",
        mintError: message,
        updatedAt: Date.now(),
      });
      res.status(500).json({ error: "Mint transaction failed", detail: message });
      return;
    }

    await ordersRef().child(reference).update({
      status: "minted",
      mintTxHash: txHash,
      updatedAt: Date.now(),
    });

    const units = (order.whAmount / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
    await sendNotification(order.walletAddress, {
      type: "topup",
      title: "Top-up complete",
      body: `₦${Number(order.amountNgn).toLocaleString()} payment confirmed — ${units} unit${order.whAmount === 1000 ? "" : "s"} added to your balance.`,
    });

    res.status(200).json({ ok: true, minted: true, txHash });
  } catch (error) {
    console.error("opay callback failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
