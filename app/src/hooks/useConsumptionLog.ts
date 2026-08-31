import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { apiRequest } from "../services/apiClient";

/** The windows the chart offers. Each is paired server-side with a bucket
 * size, so a longer range returns fewer, wider points rather than a larger
 * payload -- see CONSUMPTION_RANGES in api/data.ts. */
export const CONSUMPTION_RANGES = ["1h", "6h", "24h", "7d", "14d"] as const;
export type ConsumptionRange = (typeof CONSUMPTION_RANGES)[number];

export const RANGE_LABELS: Record<ConsumptionRange, string> = {
  "1h": "1H",
  "6h": "6H",
  "24h": "24H",
  "7d": "7D",
  "14d": "14D",
};

export type ConsumptionPoint = {
  /** Absolute epoch milliseconds at the start of the bucket. */
  t: number;
  /** Average watts across the bucket, derived from the meter's energy
   * counter. This is the honest curve. */
  avgW: number;
  /** Mean of the instantaneous spot readings in the bucket, for reference. */
  w: number;
};

export type ConsumptionWindow = {
  range: ConsumptionRange;
  bucketMin: number;
  startMs: number;
  endMs: number;
  points: ConsumptionPoint[];
  totalWh: number;
  peakW: number;
};

/** How often a live view re-fetches. Matched to the bucket rather than beating
 * it: on a 7d view bucketed hourly there is nothing new to see every minute. */
function refreshMsFor(range: ConsumptionRange): number {
  switch (range) {
    case "1h": return 30_000;
    case "6h": return 60_000;
    case "24h": return 120_000;
    default:   return 300_000;
  }
}

/**
 * A window of the meter's own consumption log.
 *
 * The meter writes a sample a minute to Firebase whether or not anyone has
 * the app open, so unlike the old in-memory live buffer this survives leaving
 * the screen, closing the app, and the meter itself going offline. That is
 * what makes looking back over hours or days possible at all.
 */
export function useConsumptionLog(
  walletAddress: string | null,
  getSigner: () => Promise<ethers.Signer>,
  range: ConsumptionRange
) {
  const [data, setData] = useState<ConsumptionWindow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (!walletAddress || inFlight.current) return;
      inFlight.current = true;
      if (showSpinner) setLoading(true);
      try {
        const result = await apiRequest<ConsumptionWindow & { hasDevice: boolean }>(
          `/api/data?resource=consumption&range=${range}`,
          walletAddress,
          getSigner
        );
        setData({
          range,
          bucketMin: result.bucketMin ?? 1,
          startMs: result.startMs ?? 0,
          endMs: result.endMs ?? Date.now(),
          points: result.points ?? [],
          totalWh: result.totalWh ?? 0,
          peakW: result.peakW ?? 0,
        });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load consumption history.");
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [walletAddress, getSigner, range]
  );

  useEffect(() => {
    // Spinner only when the range changes; the periodic refresh updates in
    // place so the chart doesn't blink while you're watching it.
    load(true);
    const timer = setInterval(() => load(false), refreshMsFor(range));
    return () => clearInterval(timer);
  }, [load, range]);

  return { data, loading, error, refresh: () => load(false) };
}
