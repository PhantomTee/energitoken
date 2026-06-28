import { ref, get, set } from "firebase/database";
import { db } from "./firebase";

/** Reads the current budget for a device, in Wh -- null if never set. */
export async function getBudgetWh(deviceId: string): Promise<number | null> {
  const snapshot = await get(ref(db, `meters/${deviceId}/budgetWh`));
  return snapshot.exists() ? (snapshot.val() as number) : null;
}

/**
 * Sets the budget for a device, in Wh. Last-write-wins -- whoever sets it
 * most recently is what the meter (and Dashboard) sees, same as any other
 * Firebase field; no merge/versioning logic needed since only the paired
 * household's own app can write here (see database.rules.json).
 */
export async function setBudgetWh(deviceId: string, budgetWh: number): Promise<void> {
  await set(ref(db, `meters/${deviceId}/budgetWh`), budgetWh);
}
