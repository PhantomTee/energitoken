import { ref, get, set, update, serverTimestamp } from "firebase/database";
import { db } from "./firebase";

/** Reads the current budget for a device, in Wh -- null if never set. */
export async function getBudgetWh(deviceId: string): Promise<number | null> {
  const snapshot = await get(ref(db, `meters/${deviceId}/budgetWh`));
  return snapshot.exists() ? (snapshot.val() as number) : null;
}

/**
 * Sets the budget for a device, in Wh, and starts a new consumption cycle
 * atomically. Last-write-wins -- whoever sets it most recently is what the
 * meter (and Dashboard) sees, same as any other Firebase field; no
 * merge/versioning logic needed since only the paired household's own app
 * can write here (see database.rules.json).
 *
 * budgetWh is a DAILY figure (see budget.tsx), not a whole-period total, so
 * something has to separately tell the firmware "a new day/cycle has
 * started" -- that's cycleStartedAt. Writing both fields in one update()
 * keeps them from ever landing as two separate, out-of-order writes.
 * A daily cron (api/oracle/cycle-tick.ts) also rewrites cycleStartedAt on
 * its own schedule, so the cycle keeps rolling even if the household never
 * reopens the Budget screen again after their first setup.
 */
export async function setBudgetWh(deviceId: string, budgetWh: number): Promise<void> {
  await update(ref(db, `meters/${deviceId}`), {
    budgetWh,
    cycleStartedAt: serverTimestamp(),
  });
}

/**
 * Mirrors the household's spendable ENGY balance into Firebase so the
 * physical meter (which has no way to read the chain itself) can show it on
 * its local balance screen. Spendable, not raw on-chain balance -- that's
 * the figure that's actually still theirs to use, same distinction the app
 * shows on Dashboard/Transfer. Best-effort: called after every balance
 * refresh, so a missed write just means the meter's screen is stale until
 * the next one, not a broken state.
 */
export async function setMeterTokenBalance(deviceId: string, spendableWh: number): Promise<void> {
  await set(ref(db, `meters/${deviceId}/tokenBalance`), spendableWh);
}
