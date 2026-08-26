import { ethers } from "ethers";
import { apiRequest } from "./apiClient";

/**
 * Sets the budget for a device, in Wh, and starts a new consumption cycle
 * atomically -- via /api/meters/budget (server-side, Admin SDK).
 *
 * budgetWh is a DAILY figure (see budget.tsx), not a whole-period total, so
 * something has to separately tell the firmware "a new day/cycle has
 * started" -- that's cycleStartedAt, written in the same request so the two
 * fields never land as separate, out-of-order writes. A daily cron
 * (api/oracle/cycle-tick.ts) also rewrites cycleStartedAt on its own
 * schedule, so the cycle keeps rolling even if the household never reopens
 * the Budget screen again after their first setup.
 */
export async function setBudgetWh(
  budgetWh: number,
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<void> {
  await apiRequest("/api/meters/budget", walletAddress, getSigner, { method: "POST", body: { budgetWh } });
}

/**
 * Mirrors the household's spendable ENGY balance into Firebase so the
 * physical meter (which has no way to read the chain itself) can show it on
 * its local balance screen, and so the meter's fail-closed relay gate can
 * see a real balance. Best-effort: called after every balance refresh, so a
 * missed write just means the meter's screen/gate is stale until the next
 * one, not a broken state.
 */
export async function setMeterTokenBalance(
  spendableWh: number,
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<void> {
  await apiRequest("/api/meters/token-balance", walletAddress, getSigner, {
    method: "POST",
    body: { spendableWh },
  });
}
