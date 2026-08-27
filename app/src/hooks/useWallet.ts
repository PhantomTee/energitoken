import { useCallback } from "react";
import { usePrivy, useEmbeddedEthereumWallet } from "@privy-io/expo";
import { ethers } from "ethers";

/**
 * Single place the rest of the app reads "who is logged in and what's their
 * wallet" from, so screens don't each need to know Privy's hook shapes.
 */
export function useWallet() {
  const { user, isReady, logout } = usePrivy();
  const { wallets } = useEmbeddedEthereumWallet();

  const wallet = wallets[0];
  const walletAddress = wallet?.address ?? null;
  const email = user?.linked_accounts.find((account) => account.type === "email")?.address ?? null;

  /**
   * Wraps the embedded wallet's EIP-1193 provider in an ethers signer, so
   * screens can send real transactions (e.g. transfer()) through Privy
   * without touching Privy's API shape directly.
   */
  // Memoized for the same reason as useWallet.web.ts's getSigner: an
  // unstable reference here becomes a fresh reference in every
  // useCallback/useEffect elsewhere that lists it as a dependency, which
  // can cascade into effects re-arming and re-firing (including real
  // network calls) far more often than an actual mount/focus event.
  const getSigner = useCallback(async (): Promise<ethers.Signer> => {
    if (!wallet) throw new Error("No embedded wallet available");
    const eip1193Provider = await wallet.getProvider();
    const browserProvider = new ethers.BrowserProvider(eip1193Provider);
    return browserProvider.getSigner();
  }, [wallet]);

  return {
    isReady,
    isAuthenticated: !!user,
    walletAddress,
    email,
    getSigner,
    logout,
  };
}
