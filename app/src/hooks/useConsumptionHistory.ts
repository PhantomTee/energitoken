import { useEffect, useRef, useState } from "react";
import { MeterReading } from "../mock/mockMeterData";

export type PowerPoint = { t: number; watts: number };

const WINDOW_MS = 10 * 60 * 1000; // keep the last 10 minutes of live readings

/**
 * Accumulates a rolling client-side history of power draw from live meter
 * readings, for the Dashboard's live consumption graph. There's nowhere to
 * read this from Firebase -- /meters/{deviceId} is overwritten on every
 * push, it never stores a series -- so this just remembers each new reading
 * useMeterData's poll delivers, deduped by updatedAt, and drops anything
 * older than WINDOW_MS. Resets on remount (new screen visit), which is the
 * right behavior for a "live" view rather than a persisted history -- the
 * History tab already covers actual settled consumption from burn events.
 */
export function useConsumptionHistory(reading: MeterReading | null): PowerPoint[] {
  const [points, setPoints] = useState<PowerPoint[]>([]);
  const lastUpdatedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!reading || reading.power == null) return;
    if (lastUpdatedAtRef.current === reading.updatedAt) return; // same reading polled again
    lastUpdatedAtRef.current = reading.updatedAt;

    const now = Date.now();
    setPoints((prev) => {
      const next = [...prev, { t: now, watts: reading.power }];
      const cutoff = now - WINDOW_MS;
      return next.filter((p) => p.t >= cutoff);
    });
  }, [reading]);

  return points;
}
