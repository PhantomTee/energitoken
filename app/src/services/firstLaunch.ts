import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "energitoken_has_seen_onboarding";

/** True once the user has completed (or skipped past) the welcome carousel. */
export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === "true";
  } catch {
    // If storage itself is broken, don't block the user on the carousel forever.
    return true;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, "true");
  } catch {
    // best-effort
  }
}
