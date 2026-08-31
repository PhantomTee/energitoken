import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { apiRequest } from "../services/apiClient";

export type DailyUsageDay = {
  /** YYYYMMDD in West Africa Time, matching the meter's own day keys. */
  day: string;
  /** Watt-hours the meter actually measured that day. */
  wh: number;
};

const REFRESH_MS = 5 * 60 * 1000;

/** "12 Aug"-style label for a YYYYMMDD key, parsed as a plain calendar date
 * rather than through the phone's timezone -- the key is already WAT. */
export function dayKeyLabel(day: string): string {
  const d = new Date(Date.UTC(
    Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))
  ));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Measured consumption per WAT calendar day.
 *
 * Replaces a hook that bucketed burnHistory -- the log of settled ON-CHAIN
 * burns -- into days. That was the wrong source for "how much did this
 * household use": an entry only exists once the oracle has run and had a
 * positive delta to settle, so the log lagged reality by hours and vanished
 * entirely for three days when the oracle lock wedged. It also bucketed by
 * the PHONE's calendar day while every other date in the system is WAT, so
 * bars could land on the wrong day for anyone not in that zone.
 *
 * This reads what the meter measured, which exists the moment it happens.
 */
export function useDailyConsumption(
  walletAddress: string | null,
  getSigner: () => Promise<ethers.Signer>,
  days: number
) {
  const [data, setData] = useState<DailyUsageDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!walletAddress || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await apiRequest<{ hasDevice: boolean; days: DailyUsageDay[] }>(
        `/api/data?resource=dailyUsage&days=${days}`,
        walletAddress,
        getSigner
      );
      setData(result.days ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load daily consumption.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [walletAddress, getSigner, days]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return { days: data, loading, error, refresh: load };
}
