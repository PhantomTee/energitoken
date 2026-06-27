import { useEffect, useState } from "react";
import { ref, onValue, off } from "firebase/database";
import { db } from "../services/firebase";
import { ensureFirebaseSession } from "../services/firebaseSession";
import { MeterReading, mockMeterReadingA } from "../mock/mockMeterData";

export type MeterMode = "mock" | "live";

/**
 * In mock mode, returns a static reading instantly. In live mode, binds this
 * device's Firebase session to the wallet (write-once /uidToWallet entry the
 * security rules require) and attaches a realtime listener to
 * /meters/{walletAddress}. The same hook shape either way, so the Dashboard's
 * mock/live toggle just swaps the `mode` argument.
 */
export function useMeterData(walletAddress: string | null, mode: MeterMode) {
  const [reading, setReading] = useState<MeterReading | null>(mode === "mock" ? mockMeterReadingA : null);
  const [loading, setLoading] = useState(mode === "live");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "mock") {
      setReading(mockMeterReadingA);
      setLoading(false);
      setError(null);
      return;
    }

    if (!walletAddress) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const meterRef = ref(db, `meters/${walletAddress}`);

    ensureFirebaseSession(walletAddress)
      .then(() => {
        if (cancelled) return;
        onValue(
          meterRef,
          (snapshot) => {
            if (cancelled) return;
            setReading(snapshot.exists() ? (snapshot.val() as MeterReading) : null);
            setLoading(false);
          },
          (err) => {
            if (cancelled) return;
            setError(err.message);
            setLoading(false);
          }
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to start live session.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      off(meterRef);
    };
  }, [walletAddress, mode]);

  return { reading, loading, error };
}
