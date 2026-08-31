import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { apiRequest } from "../services/apiClient";

export type ConsumptionSample = {
  /** Minutes past local (WAT) midnight, 0..1439. */
  minute: number;
  /** Instantaneous watts the meter reported at that moment. */
  w: number;
  /** Average watts across the interval ending at this sample, derived
   * server-side from the lifetime energy delta. This is the honest
   * consumption curve; `w` is a spot reading that can alias. */
  avgW: number;
};

export type ConsumptionDay = {
  day: string;          // YYYYMMDD, West Africa Time
  samples: ConsumptionSample[];
  totalWh: number;
  peakW: number;
};

/** Polls only while viewing today. A past day is finished and cannot change,
 * so re-fetching it would be pure waste. Matches the meter's own one-minute
 * sample cadence rather than beating it. */
const LIVE_REFRESH_MS = 60_000;

const WAT_OFFSET_MS = 60 * 60 * 1000;

/** YYYYMMDD in WAT, matching the day keys the firmware writes. */
export function watDayKey(date: Date = new Date()): string {
  return new Date(date.getTime() + WAT_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, "");
}

/** Shifts a YYYYMMDD key by whole days, for the chart's back/forward controls. */
export function shiftDayKey(day: string, deltaDays: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(4, 6)) - 1;
  const d = Number(day.slice(6, 8));
  const shifted = new Date(Date.UTC(y, m, d) + deltaDays * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10).replace(/-/g, "");
}

/** "Today", "Yesterday", or a written date, for labelling the chart. */
export function describeDayKey(day: string): string {
  const today = watDayKey();
  if (day === today) return "Today";
  if (day === shiftDayKey(today, -1)) return "Yesterday";
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(4, 6)) - 1;
  const d = Number(day.slice(6, 8));
  return new Date(Date.UTC(y, m, d)).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * One West Africa Time day of the meter's own consumption log.
 *
 * The meter writes a sample a minute to Firebase whether or not anyone has
 * the app open, so unlike the old in-memory live buffer this survives
 * leaving the screen, closing the app, and the meter itself going offline.
 * That is what makes browsing back to yesterday possible at all.
 */
export function useConsumptionLog(
  walletAddress: string | null,
  getSigner: () => Promise<ethers.Signer>,
  day: string
) {
  const [data, setData] = useState<ConsumptionDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (!walletAddress || inFlight.current) return;
      inFlight.current = true;
      if (showSpinner) setLoading(true);
      try {
        const result = await apiRequest<ConsumptionDay & { hasDevice: boolean }>(
          `/api/data?resource=consumption&day=${day}`,
          walletAddress,
          getSigner
        );
        setData({
          day: result.day,
          samples: result.samples ?? [],
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
    [walletAddress, getSigner, day]
  );

  useEffect(() => {
    // Spinner only on a day change; the periodic refresh below updates in
    // place so the chart doesn't blink once a minute.
    load(true);
    if (day !== watDayKey()) return;
    const timer = setInterval(() => load(false), LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, day]);

  return { data, loading, error, refresh: () => load(false) };
}
