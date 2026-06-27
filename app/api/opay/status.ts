import type { IncomingMessage, ServerResponse } from "http";
import { ordersRef } from "../_lib/firebaseAdmin";

type Req = IncomingMessage & { method?: string; url?: string };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/** Lets the app poll an order's state while the real-time balance read (Step 7) isn't wired yet. */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const reference = new URL(req.url ?? "", "http://localhost").searchParams.get("reference");
  if (!reference) {
    res.status(400).json({ error: "Missing reference query param" });
    return;
  }

  const snapshot = await ordersRef().child(reference).get();
  const order = snapshot.val();
  if (!order) {
    res.status(404).json({ error: "Unknown reference" });
    return;
  }

  res.status(200).json({
    status: order.status,
    whAmount: order.whAmount,
    mintTxHash: order.mintTxHash ?? null,
  });
}
