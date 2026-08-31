import type { IncomingMessage, ServerResponse } from "http";
import { claimOrderForProcessing, releaseOrder } from "../_lib/paymentOrder";
import { mintEngy } from "../_lib/mintEngy";
import { sendNotification } from "../_lib/notify";
import { resetCycleForWallet } from "../_lib/meterReset";

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
 * Gated behind ORACLE_SECRET (same shared secret as /api/oracle/burn),
 * fail-closed -- an unset env var rejects every request rather than
 * silently skipping the check. Without this, anyone who learns an order
 * reference (a log line, a client network trace, a support ticket) could
 * trigger a mint with no credential at all.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.ORACLE_SECRET;
  const provided = req.headers["x-oracle-secret"];
  if (!secret || provided !== secret) {
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

    // Atomic claim (same mechanism as callback.ts): only one caller can ever
    // move this order out of "mint_failed", so a retry-mint call racing a
    // fresh Flutterwave webhook retry can't both attempt to mint it.
    const claim = await claimOrderForProcessing(reference, ["mint_failed"]);
    if (!claim.claimed) {
      if (!claim.order) {
        res.status(404).json({ error: "Unknown reference" });
        return;
      }
      res.status(400).json({ error: `Order is in '${claim.order.status}' state, not 'mint_failed' -- refusing to retry` });
      return;
    }
    const order = claim.order;

    let txHash: string;
    try {
      txHash = await mintEngy(order.walletAddress, order.whAmount);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown mint error";
      await releaseOrder(reference, "mint_failed", { mintError: message });
      res.status(500).json({ error: "Retry failed", detail: message });
      return;
    }

    await releaseOrder(reference, "minted", { mintTxHash: txHash });

    await resetCycleForWallet(order.walletAddress).catch((err) =>
      console.error("payments/retry-mint: resetCycleForWallet failed", err)
    );

    const units = (order.whAmount / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
    await sendNotification(order.walletAddress, {
      type: "topup",
      title: "Top-up complete",
      body: `₦${Number(order.amountNgn).toLocaleString()} payment confirmed -- ${units} unit${order.whAmount === 1000 ? "" : "s"} added to your balance.`,
    });

    res.status(200).json({ ok: true, minted: true, txHash });
  } catch (error) {
    console.error("payments/retry-mint failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
