import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Redirect } from "expo-router";
import { useWallet } from "../src/hooks/useWallet";
import { BrandSplash } from "../src/components/BrandSplash";
import { resolvePostAuthDestination, PostAuthDestination } from "../src/services/postAuthRouting";
import { isWithinQuickAuthWindow, clearFullLogin } from "../src/services/quickAuth";
import { consumeJustLoggedIn } from "../src/services/loginFlag";

type Destination = "/login" | "/unlock" | PostAuthDestination;

/**
 * THE routing brain. Every screen that finishes an auth step navigates back
 * to "/" and this component decides where the user actually belongs:
 *
 *   - Not authenticated (or authenticated with no wallet) → /login,
 *     which owns the recovery path for wallet-less accounts.
 *   - Fresh login (marked via loginFlag) → straight to onboarding/dashboard,
 *     no biometric detour even on native.
 *   - Native cold start within the 12h quick-auth window → /unlock.
 *   - Native cold start past the window → force logout → /login.
 *   - Web (or post-unlock) → paired? dashboard : onboarding.
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
        const justLoggedIn = consumeJustLoggedIn();

        if (Platform.OS !== "web" && !justLoggedIn) {
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

        // Web, or a login that literally just completed: resolve final home.
        const dest = await resolvePostAuthDestination(walletAddress);
        if (!cancelled) setDestination(dest);
      } catch {
        if (cancelled) return;
        // Don't strand the user on a blank splash if a check above throws —
        // the dashboard can surface the real error on the next user action.
        setDestination("/(tabs)/dashboard");
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
