import { ServerValue } from "firebase-admin/database";
import { adminDb, deviceIdForWallet } from "./firebaseAdmin";

/**
 * Rolls a fresh budget cycle and clears any relay overrides for the device
 * paired to this wallet, best-effort. Called after a successful top-up: the
 * household just added real balance, so a relay shed from budget exhaustion
 * (percentUsed resets to 0% on a fresh cycle) or left behind by a stale
 * manual override should come back on its own, not require the household to
 * notice and re-toggle each tier by hand. No-op if the wallet has no paired
 * device yet -- nothing to reset. Does NOT touch budgetWh itself; a top-up
 * relaxes today's exhaustion, it doesn't remove the household's set budget.
 */
export async function resetCycleForWallet(walletAddress: string): Promise<void> {
  const deviceId = await deviceIdForWallet(walletAddress);
  if (!deviceId) return;
  await adminDb().ref(`meters/${deviceId}`).update({ cycleStartedAt: ServerValue.TIMESTAMP });
  await adminDb().ref(`meters/${deviceId}/relayOverrides`).remove();
}
