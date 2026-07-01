import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Redirect } from "expo-router";
import { useWallet } from "../src/hooks/useWallet";
import { BrandSplash } from "../src/components/BrandSplash";
import { resolvePostAuthDestination, PostAuthDestination } from "../src/services/postAuthRouting";
import { isWithinQuickAuthWindow, clearFullLogin } from "../src/services/quickAuth";

type Destination = "/login" | "/unlock" | PostAuthDestination;

/**
 * Entry point. Routes to login if not authenticated.
 *
 * On native, an already-authenticated cold start doesn't go straight to the
 * dashboard -- it detours through /unlock for a quick biometric/PIN check,
 * as long as that's happened within the last 12h (src/services/quickAuth.ts).
 * Past 12h, the Privy session is dropped and a full email-code login is
 * required again. This is a deliberate app-level policy layered on top of
 * Privy, not something Privy's own session length controls. Web has no
 * equivalent concept -- biometrics aren't part of this app's web flow.
 */
export default function Index() {
  const { isReady, isAuthenticated, walletAddress, logout } = useWallet();
  const [destination, setDestination] = useState<Destination | null>(null);

  useEffect(() => {
    if (!isReady) return;

    if (!isAuthenticated || !walletAddress) {
      setDestination("/login");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        if (Platform.OS !== "web") {
          const withinWindow = await isWithinQuickAuthWindow();
          if (cancelled) return;

          if (!withinWindow) {
            await clearFullLogin();
            await logout();
            if (!cancelled) setDestination("/login");
            return;
          }

          setDestination("/unlock");
          return;
        }

        const dest = await resolvePostAuthDestination(walletAddress);
        if (!cancelled) setDestination(dest);
      } catch {
        if (cancelled) return;
        // Don't strand the user on a blank splash if a check above throws --
        // send them somewhere that can surface the real error on next action.
        setDestination(Platform.OS !== "web" ? "/unlock" : "/onboarding");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, isAuthenticated, walletAddress, logout]);

  if (!destination) {
    return <BrandSplash />;
  }

  return <Redirect href={destination} />;
}
