/**
 * In-memory "just logged in" marker, set by the login screens right before
 * they hand control back to the index route ("/"). Lets index.tsx distinguish
 * a fresh login (go straight to onboarding/dashboard) from a cold start
 * (native detours through /unlock for biometrics).
 *
 * Deliberately NOT persisted: a page refresh or app restart clears it, which
 * is exactly the behavior we want — those are cold starts.
 */
let justLoggedIn = false;

export function markJustLoggedIn(): void {
  justLoggedIn = true;
}

/** Reads and clears the flag — one navigation decision per login. */
export function consumeJustLoggedIn(): boolean {
  const value = justLoggedIn;
  justLoggedIn = false;
  return value;
}
