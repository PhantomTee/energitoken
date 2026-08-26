import { ethers } from "ethers";
import { apiRequest } from "./apiClient";

/** Called once after login so others can find this wallet by email, via
 * /api/directory/register (server-side, Admin SDK). */
export async function writeDirectoryEntry(
  email: string,
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<void> {
  await apiRequest("/api/directory/register", walletAddress, getSigner, { method: "POST", body: { email } });
}

/** Resolves a recipient email to a wallet address, or null if not found, via
 * /api/directory/resolve (server-side, Admin SDK). `callerWalletAddress` is
 * the signed-in caller (used to authenticate the request), not the
 * recipient being looked up. */
export async function resolveEmailToAddress(
  email: string,
  callerWalletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<string | null> {
  const result = await apiRequest<{ walletAddress: string | null }>(
    `/api/directory/resolve?email=${encodeURIComponent(email)}`,
    callerWalletAddress,
    getSigner
  );
  return result.walletAddress;
}
