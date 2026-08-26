import { ethers } from "ethers";
import { apiRequest } from "./apiClient";

/** Called once after login so others can find this wallet by email, via
 * /api/data (server-side, Admin SDK). */
export async function writeDirectoryEntry(
  email: string,
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<void> {
  await apiRequest("/api/data", walletAddress, getSigner, {
    method: "POST",
    body: { resource: "directory", action: "register", email },
  });
}

/** Resolves a recipient email to a wallet address, or null if not found, via
 * /api/data (server-side, Admin SDK). `callerWalletAddress` is the
 * signed-in caller (used to authenticate the request), not the recipient
 * being looked up. */
export async function resolveEmailToAddress(
  email: string,
  callerWalletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<string | null> {
  const result = await apiRequest<{ walletAddress: string | null }>(
    `/api/data?resource=directory&email=${encodeURIComponent(email)}`,
    callerWalletAddress,
    getSigner
  );
  return result.walletAddress;
}
