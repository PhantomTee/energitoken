import { useEffect, useState } from "react";
import { ref, onValue, off } from "firebase/database";
import { db } from "../services/firebase";
import { ensureFirebaseSession } from "../services/firebaseSession";
import { getDeviceForWallet } from "../services/deviceBinding";
import { MeterReading, mockMeterReadingA } from "../mock/mockMeterData";

export type MeterMode = "mock" | "live";

/**
 * In mock mode, returns a static reading instantly. In live mode, binds this
 * device's Firebase session to the wallet, resolves which physical meter
 * that wallet is paired with (/walletToDevice/{wallet}), and attaches a
 * realtime listener to /meters/{deviceId}. If the wallet has no device
 * paired yet, `hasDevice` is false and the caller should prompt onboarding
 * rather than show a spinner forever.
 */
export function useMeterData(walletAddress: string | null, mode: MeterMode) {
  const [reading, setReading] = useState<MeterReading | null>(mode === "mock" ? mockMeterReadingA : null);
  const [loading, setLoading] = useState(mode === "live");
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [hasDevice, setHasDevice] = useState(true);

  useEffect(() => {
    if (mode === "mock") {
      setReading(mockMeterReadingA);
      setLoading(false);
      setError(null);
      setHasDevice(true);
      return;
    }

    if (!walletAddress) return;

    let cancelled = false;
    let meterRef: ReturnType<typeof ref> | null = null;
    setLoading(true);
    setError(null);

    ensureFirebaseSession(walletAddress)
      .then(() => getDeviceForWallet(walletAddress))
      .then((boundDeviceId) => {
        if (cancelled) return;

        if (!boundDeviceId) {
          setHasDevice(false);
          setDeviceId(null);
          setLoading(false);
          return;
        }

        setHasDevice(true);
        setDeviceId(boundDeviceId);
        meterRef = ref(db, `meters/${boundDeviceId}`);
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
      if (meterRef) off(meterRef);
    };
  }, [walletAddress, mode]);

  return { reading, loading, error, deviceId, hasDevice };
}
