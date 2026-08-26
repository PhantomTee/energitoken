import { ethers } from "ethers";
import { apiRequest } from "./apiClient";
import { RelayState } from "../mock/mockMeterData";

export type RelayTierKey = keyof RelayState;

/**
 * Sets a manual override for one relay tier, or clears it back to "auto",
 * via /api/meters/relay-override (server-side, Admin SDK). `value: true`
 * forces the load on, `false` forces it off, `null` removes the override so
 * firmware's own budget-shedding logic decides again.
 */
export async function setRelayOverride(
  tier: RelayTierKey,
  value: boolean | null,
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<void> {
  await apiRequest("/api/data", walletAddress, getSigner, {
    method: "POST",
    body: { resource: "meters", action: "relay-override", tier, value },
  });
}
