import * as SecureStore from "expo-secure-store";

/**
 * Native-only "quick unlock" window: full Privy email-code login is annoying
 * to repeat every app open, so once the user has done it, a biometric/PIN
 * check is enough for QUICK_AUTH_WINDOW_MS afterward. Past that window, a
 * full code login is required again, regardless of whether Privy's own
 * session token is still technically valid -- this is a deliberate app-level
 * policy on top of Privy, not a Privy session setting.
 */
const LAST_FULL_LOGIN_KEY = "energitoken_last_full_login_at";
export const QUICK_AUTH_WINDOW_MS = 12 * 60 * 60 * 1000;

export async function recordFullLogin(): Promise<void> {
  await SecureStore.setItemAsync(LAST_FULL_LOGIN_KEY, String(Date.now()));
}

export async function isWithinQuickAuthWindow(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(LAST_FULL_LOGIN_KEY);
  if (!raw) return false;
  const lastLoginAt = Number(raw);
  return Number.isFinite(lastLoginAt) && Date.now() - lastLoginAt < QUICK_AUTH_WINDOW_MS;
}

export async function clearFullLogin(): Promise<void> {
  await SecureStore.deleteItemAsync(LAST_FULL_LOGIN_KEY);
}
