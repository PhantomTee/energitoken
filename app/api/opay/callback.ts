import type { IncomingMessage, ServerResponse } from "http";
import { ordersRef } from "../_lib/firebaseAdmin";
import { mintEngy } from "../_lib/mintEngy";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * OPay calls this server-to-server when a Cashier payment's status changes.
 *
 * KNOWN LIMITATION: OPay's published docs describe a "Query Payment Status"
 * endpoint for re-verifying a callback before trusting it (recommended,
 * since this callback body alone isn't signed in the docs excerpt available
 * for this project). That re-verification call is NOT implemented here —
 * for this academic build the callback's reported status is trusted
 * directly. Flag this as a known gap if asked about callback security.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { reference, status, orderNo } = (body ?? {}) as {
      reference?: string;
      status?: string;
      orderNo?: string;
    };

    if (!reference) {
      res.status(400).json({ error: "Missing reference" });
      return;
    }

    const snapshot = await ordersRef().child(reference).get();
    const order = snapshot.val();
    if (!order) {
      res.status(404).json({ error: "Unknown reference" });
      return;
    }

    // Idempotency: never mint twice for the same order, no matter how many
    // times OPay retries the callback.
    if (order.status === "minted") {
      res.status(200).json({ ok: true, alreadyMinted: true });
      return;
    }

    if (status !== "SUCCESS") {
      await ordersRef().child(reference).update({
        status: "failed",
        orderNo: orderNo ?? order.orderNo ?? null,
        updatedAt: Date.now(),
      });
      res.status(200).json({ ok: true, minted: false });
      return;
    }

    const txHash = await mintEngy(order.walletAddress, order.whAmount);

    await ordersRef().child(reference).update({
      status: "minted",
      orderNo: orderNo ?? order.orderNo ?? null,
      mintTxHash: txHash,
      updatedAt: Date.now(),
    });

    res.status(200).json({ ok: true, minted: true, txHash });
  } catch (error) {
    console.error("opay callback failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
