import { ethers } from "ethers";
import { getDeviceForWallet } from "./deviceBinding";

export type PostAuthDestination = "/onboarding" | "/(tabs)/dashboard";

/** Shared by index.tsx (cold start) and unlock.tsx (after a biometric/PIN unlock). */
export async function resolvePostAuthDestination(
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<PostAuthDestination> {
  const deviceId = await getDeviceForWallet(walletAddress, getSigner);
  return deviceId ? "/(tabs)/dashboard" : "/onboarding";
}
