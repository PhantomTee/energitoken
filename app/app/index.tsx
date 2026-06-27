import React, { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { useWallet } from "../src/hooks/useWallet";
import { BrandSplash } from "../src/components/BrandSplash";
import { ensureFirebaseSession } from "../src/services/firebaseSession";
import { getDeviceForWallet } from "../src/services/deviceBinding";

type Destination = "/login" | "/onboarding" | "/(tabs)/dashboard";

/**
 * Entry point. Routes to login if not authenticated; if authenticated but
 * the wallet has no device bound yet (/walletToDevice/{wallet} is empty),
 * routes to onboarding instead of the dashboard.
 */
export default function Index() {
  const { isReady, isAuthenticated, walletAddress } = useWallet();
  const [destination, setDestination] = useState<Destination | null>(null);

  useEffect(() => {
    if (!isReady) return;

    if (!isAuthenticated || !walletAddress) {
      setDestination("/login");
      return;
    }

    let cancelled = false;
    ensureFirebaseSession(walletAddress)
      .then(() => getDeviceForWallet(walletAddress))
      .then((deviceId) => {
        if (cancelled) return;
        setDestination(deviceId ? "/(tabs)/dashboard" : "/onboarding");
      })
      .catch(() => {
        if (cancelled) return;
        // If the device-binding check fails for any reason, don't strand the
        // user on a blank splash -- send them to onboarding, which will
        // surface the real error on the next action.
        setDestination("/onboarding");
      });

    return () => {
      cancelled = true;
    };
  }, [isReady, isAuthenticated, walletAddress]);

  if (!destination) {
    return <BrandSplash />;
  }

  return <Redirect href={destination} />;
}
