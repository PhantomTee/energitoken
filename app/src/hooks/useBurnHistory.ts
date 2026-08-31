import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { apiRequest } from "../services/apiClient";

export type BurnHistoryEntry = { deltaWh: number; timestamp: number };

/**
 * Polls /api/data?resource=burnHistory for this wallet's device's durable
 * per-burn log, written by oracle/burn.ts on every real burn. Exists
 * because on-chain event scanning (contractEvents.ts's getTransactionHistory)
 * is capped to the last ~3,000 blocks -- on Sepolia's ~12s block time, about
 * ten hours -- nowhere near enough to support a 7/14/30-day consumption
 * chart given how infrequently the burn oracle actually runs.
 */
export function useBurnHistory(walletAddress: string | null, getSigner: () => Promise<ethers.Signer>) {
  const [entries, setEntries] = useState<BurnHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<{ entries: BurnHistoryEntry[] }>(
        "/api/data?resource=burnHistory",
        walletAddress,
        getSigner
      );
      setEntries(result.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load consumption history.");
    } finally {
      setLoading(false);
    }
  }, [walletAddress, getSigner]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, loading, error, refresh };
}
