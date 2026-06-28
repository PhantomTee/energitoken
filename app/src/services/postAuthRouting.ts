import { ensureFirebaseSession } from "./firebaseSession";
import { getDeviceForWallet } from "./deviceBinding";

export type PostAuthDestination = "/onboarding" | "/(tabs)/dashboard";

/** Shared by index.tsx (cold start) and unlock.tsx (after a biometric/PIN unlock). */
export async function resolvePostAuthDestination(walletAddress: string): Promise<PostAuthDestination> {
  await ensureFirebaseSession(walletAddress);
  const deviceId = await getDeviceForWallet(walletAddress);
  return deviceId ? "/(tabs)/dashboard" : "/onboarding";
}
