import { ordersRef, PaymentOrder, PaymentOrderStatus } from "./firebaseAdmin";

/**
 * Atomically claims an order for processing by moving it into "processing"
 * -- closes the race where two concurrent webhook deliveries (Flutterwave
 * retries, or callback.ts and retry-mint.ts running at once) both read the
 * order's status as "not yet minted" before either has written anything,
 * and both proceed to mint. Firebase's transaction() re-runs the update
 * function against the server's actual current value if it changed since
 * the client last read it, so only one caller's transaction can ever
 * observe the pre-claim status and commit the move to "processing".
 *
 * `fromStatuses` lists every status this call is allowed to claim from --
 * the caller decides what's eligible (callback.ts claims from "initial"/
 * "pending"/"failed"; retry-mint.ts claims only from "mint_failed"), never
 * from "processing" or "minting" (already in flight) or "minted" (done).
 */
export async function claimOrderForProcessing(
  txRef: string,
  fromStatuses: readonly PaymentOrderStatus[]
): Promise<{ claimed: true; order: PaymentOrder } | { claimed: false; order: PaymentOrder | null }> {
  const ref = ordersRef().child(txRef);
  const result = await ref.transaction((current: PaymentOrder | null) => {
    if (!current) return current; // no such order -- abort, nothing to claim
    if (!fromStatuses.includes(current.status)) return; // undefined = abort the transaction, leave untouched
    return { ...current, status: "processing" as PaymentOrderStatus, updatedAt: Date.now() };
  });

  if (!result.committed) {
    const snap = await ref.get();
    return { claimed: false, order: snap.exists() ? (snap.val() as PaymentOrder) : null };
  }
  return { claimed: true, order: result.snapshot.val() as PaymentOrder };
}

/** Releases a claimed order back to a processable status -- used when
 * verification determines the payment isn't actually ready to mint yet
 * (still pending settlement, or failed), so a later webhook can reclaim it. */
export async function releaseOrder(txRef: string, toStatus: PaymentOrderStatus, extra: Record<string, unknown> = {}) {
  await ordersRef().child(txRef).update({ status: toStatus, updatedAt: Date.now(), ...extra });
}
