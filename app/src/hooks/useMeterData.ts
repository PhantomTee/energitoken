import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { apiRequest } from "../services/apiClient";
import { MeterReading } from "../types/meter";

const POLL_INTERVAL_MS = 4000;

type MineResponse = { hasDevice: false } | { hasDevice: true; deviceId: string; reading: MeterReading | null };

/**
 * Polls /api/data?resource=meters (server-side, via Admin SDK) for this
 * wallet's paired device and its live reading. Replaces the old direct
 * Firebase onValue() realtime listener -- the client no longer talks to
 * Firebase at all, so this trades true push-based realtime for a short
 * poll interval, which is unaffected by any client-side Firebase Auth
 * network issues.
 */
export function useMeterData(walletAddress: string | null, getSigner: () => Promise<ethers.Signer>) {
  const [reading, setReading] = useState<MeterReading | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [hasDevice, setHasDevice] = useState(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!walletAddress) return;

    let cancelled = false;

    const poll = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const result = await apiRequest<MineResponse>("/api/data?resource=meters", walletAddress, getSigner);
        if (cancelled) return;

        if (!result.hasDevice) {
          setHasDevice(false);
          setDeviceId(null);
          setReading(null);
        } else {
          setHasDevice(true);
          setDeviceId(result.deviceId);
          setReading(result.reading);
        }
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load live data.");
      } finally {
        inFlightRef.current = false;
        if (!cancelled) setLoading(false);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [walletAddress]);

  return { reading, loading, error, deviceId, hasDevice };
}
