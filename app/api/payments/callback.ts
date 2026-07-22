import type { IncomingMessage, ServerResponse } from "http";
import { ordersRef } from "../_lib/firebaseAdmin";
import { mintEngy } from "../_lib/mintEngy";
import { verifyTransactionById, verifyWebhookSignature } from "../_lib/flutterwaveClient";
import { sendNotification } from "../_lib/notify";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Flutterwave calls this server-to-server (URL configured once in the
 * Flutterwave Dashboard -> Settings -> Webhooks, not passed per-request like
 * OPay's callbackUrl field) when a transaction's status changes.
 *
 * Security model:
 *  1. Verify the `verif-hash` header against our configured secret hash
 *     first -- rejects forged requests cheaply, before touching Firebase or
 *     Flutterwave's API.
 *  2. We still NEVER trust the webhook body's status for the mint decision
 *     -- we re-query /transactions/{id}/verify with our server credentials
 *     and use only the status returned by that authoritative call.
 *  3. We cross-check amount and currency against what we stored at order creation.
 *  4. We use a "minting" intermediate state so a process crash between mint
 *     and the Firebase update doesn't allow a second mint.
 *  5. If the mint transaction itself fails, the order is marked "mint_failed"
 *     so it's distinguishable and retriable, not stuck forever.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const verifHash = req.headers["verif-hash"];
  const signature = Array.isArray(verifHash) ? verifHash[0] : verifHash;
  if (!verifyWebhookSignature(signature)) {
    console.error("payments callback: invalid or missing verif-hash header");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const data = (body ?? {}) as { data?: { id?: number; tx_ref?: string } };
    const txRef = data.data?.tx_ref;
    const transactionId = data.data?.id;

    if (!txRef || !transactionId) {
      res.status(400).json({ error: "Missing data.tx_ref or data.id" });
      return;
    }

    // Load our stored order first — reject any reference we never created.
    const snapshot = await ordersRef().child(txRef).get();
    const order = snapshot.val();
    if (!order) {
      res.status(404).json({ error: "Unknown reference" });
      return;
    }

    // Already processed — idempotent 200 so Flutterwave stops retrying.
    if (order.status === "minted") {
      res.status(200).json({ ok: true, alreadyMinted: true });
      return;
    }

    if (order.status === "minting") {
      console.error("payments callback: order stuck in minting state", { txRef });
      res.status(500).json({ error: "Order in minting state — manual inspection required" });
      return;
    }

    // ── Re-verify with Flutterwave server-to-server ────────────────────────
    let verified;
    try {
      verified = await verifyTransactionById(transactionId);
    } catch (err) {
      console.error("payments callback: verify failed", err);
      res.status(502).json({ error: "Could not verify payment with Flutterwave" });
      return;
    }

    // Cross-check: tx_ref must match what we generated.
    if (verified.tx_ref !== txRef) {
      console.error("payments callback: tx_ref mismatch", { stored: txRef, verified: verified.tx_ref });
      res.status(400).json({ error: "tx_ref mismatch" });
      return;
    }

    // Cross-check: amount must be at least what we requested (Flutterwave
    // amounts are in whole Naira, not kobo, for this endpoint).
    if (verified.amount < order.amountNgn || verified.currency !== "NGN") {
      console.error("payments callback: amount mismatch", { expected: order.amountNgn, got: verified.amount });
      res.status(400).json({ error: "Amount mismatch — possible tampering" });
      return;
    }

    if (verified.status === "pending") {
      // Not a final state -- e.g. a bank transfer awaiting settlement.
      // Flutterwave will send another webhook once it resolves; don't mark
      // "failed" here or the payment-complete screen shows a false failure
      // to the user right before the success webhook silently mints anyway.
      await ordersRef().child(txRef).update({
        flwStatus: verified.status,
        flwTransactionId: transactionId,
        updatedAt: Date.now(),
      });
      res.status(200).json({ ok: true, minted: false, flwStatus: verified.status, pending: true });
      return;
    }

    if (verified.status !== "successful") {
      await ordersRef().child(txRef).update({
        status: "failed",
        flwStatus: verified.status,
        flwTransactionId: transactionId,
        updatedAt: Date.now(),
      });
      res.status(200).json({ ok: true, minted: false, flwStatus: verified.status });
      return;
    }

    // Mark as "minting" before we hit the chain — crash-safe intermediate state.
    await ordersRef().child(txRef).update({
      status: "minting",
      flwTransactionId: transactionId,
      verifiedAt: Date.now(),
      updatedAt: Date.now(),
    });

    let txHash: string;
    try {
      txHash = await mintEngy(order.walletAddress, order.whAmount);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown mint error";
      console.error("payments callback: mint failed", { txRef, error: message });
      await ordersRef().child(txRef).update({
        status: "mint_failed",
        mintError: message,
        updatedAt: Date.now(),
      });
      res.status(500).json({ error: "Mint transaction failed", detail: message });
      return;
    }

    await ordersRef().child(txRef).update({
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
    console.error("payments callback failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
