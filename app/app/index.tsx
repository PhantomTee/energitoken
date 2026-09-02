import React, { useEffect, useRef, useState } from "react";
import { Platform, AppState } from "react-native";
import { Redirect } from "expo-router";
import { useWallet } from "../src/hooks/useWallet";
import { BrandSplash } from "../src/components/BrandSplash";
import { resolvePostAuthDestination, PostAuthDestination } from "../src/services/postAuthRouting";
import { isWithinQuickAuthWindow, clearFullLogin } from "../src/services/quickAuth";
import { consumeJustLoggedIn } from "../src/services/loginFlag";
import { hasSeenOnboarding } from "../src/services/firstLaunch";

type Destination = "/login" | "/unlock" | "/welcome" | "/landing" | PostAuthDestination;

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
  const { isReady, isAuthenticated, walletAddress, logout, getSigner } = useWallet();
  const [destination, setDestination] = useState<Destination | null>(null);
  // Null until the first run reads the one-shot login flag; see its use below.
  const justLoggedInRef = useRef<boolean | null>(null);
  // Some Android OEM skins (observed: ColorOS/Oplus) aggressively freeze a
  // just-launched app's background work to save battery, including native
  // module callbacks like Privy's session-restore check. isReady can end up
  // genuinely resolved on the native side well before React ever gets
  // nudged to re-render with it -- the app then sits on the splash screen
  // indefinitely until something else (e.g. switching apps) forces a
  // re-render. Bumping this on every foreground transition re-runs the
  // effect below even if isReady/isAuthenticated didn't "change" from
  // React's point of view, closing that gap.
  const [foregroundNonce, setForegroundNonce] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setForegroundNonce((n) => n + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isReady) return;

    let cancelled = false;

    // Authenticated, but the wallet has not resolved yet. This is a transient
    // state part-way through login, not a logged-out one, and the two used to
    // be handled by the same branch. Deciding anything here is wrong in both
    // directions: on native it routes a user who has just logged in back to
    // /login, and on the path below it would resolve their home by asking the
    // backend which device belongs to the empty string. walletAddress is in
    // this effect's dependency list, so returning simply waits for it.
    if (isAuthenticated && !walletAddress) return;

    if (!isAuthenticated) {
      // Welcome carousel is a native-only, first-install experience --
      // shown once, before the user has ever reached login.
      if (Platform.OS === "web") {
        setDestination("/landing");
        return;
      }
      hasSeenOnboarding()
        .then((seen) => {
          if (!cancelled) setDestination(seen ? "/login" : "/welcome");
        })
        .catch(() => {
          // Don't strand the user on the splash screen if this read fails --
          // login owns its own recovery path regardless of onboarding state.
          if (!cancelled) setDestination("/login");
        });
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        // consumeJustLoggedIn() reads AND clears -- one decision per login.
        // But this effect legitimately runs more than once per login, because
        // isAuthenticated and walletAddress do not settle on the same render.
        // The second run used to find the flag already spent, treat a fresh
        // login as a cold start, fail the quick-auth window check (which no
        // new device can pass) and force a logout -- putting the user back on
        // /login to repeat the whole loop. Latching it per mount means the
        // answer survives every re-run until this screen actually navigates.
        if (justLoggedInRef.current === null) {
          justLoggedInRef.current = consumeJustLoggedIn();
        }
        const justLoggedIn = justLoggedInRef.current;

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
        const dest = await resolvePostAuthDestination(walletAddress, getSigner);
        if (!cancelled) setDestination(dest);
      } catch {
        if (cancelled) return;
        // Don't strand the user on a blank splash if a check above throws --
        // the dashboard can surface the real error on the next user action.
        setDestination("/(tabs)/dashboard");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, isAuthenticated, walletAddress, logout, foregroundNonce]);

  if (!destination) {
    return <BrandSplash />;
  }

  return <Redirect href={destination} />;
}
