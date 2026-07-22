import type { IncomingMessage, ServerResponse } from "http";
import { ordersRef } from "../_lib/firebaseAdmin";
import { mintEngy } from "../_lib/mintEngy";
import { sendNotification } from "../_lib/notify";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Operator tool: retries the mint for an order stuck in "mint_failed" --
 * a payment Flutterwave already verified as successful, where only the
 * on-chain mint step failed (e.g. an RPC hiccup). Only ever acts on orders
 * already in "mint_failed" state, which callback.ts only sets after its own
 * successful Flutterwave re-verification -- this never mints for an
 * unverified or fabricated order.
 *
 * Gated behind ORACLE_SECRET (same shared secret as /api/oracle/burn) --
 * without this, anyone who learns an order reference (a log line, a client
 * network trace, a support ticket) could trigger a mint with no credential
 * at all.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.ORACLE_SECRET;
  const provided = req.headers["x-oracle-secret"];
  if (secret && provided !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { reference } = (body ?? {}) as { reference?: string };

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

    if (order.status !== "mint_failed") {
      res.status(400).json({ error: `Order is in '${order.status}' state, not 'mint_failed' — refusing to retry` });
      return;
    }

    await ordersRef().child(reference).update({ status: "minting", updatedAt: Date.now() });

    let txHash: string;
    try {
      txHash = await mintEngy(order.walletAddress, order.whAmount);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown mint error";
      await ordersRef().child(reference).update({
        status: "mint_failed",
        mintError: message,
        updatedAt: Date.now(),
      });
      res.status(500).json({ error: "Retry failed", detail: message });
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
    console.error("payments/retry-mint failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
