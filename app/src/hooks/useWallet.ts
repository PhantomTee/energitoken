import { usePrivy, useEmbeddedEthereumWallet } from "@privy-io/expo";

/**
 * Single place the rest of the app reads "who is logged in and what's their
 * wallet" from, so screens don't each need to know Privy's hook shapes.
 */
export function useWallet() {
  const { user, isReady, logout } = usePrivy();
  const { wallets } = useEmbeddedEthereumWallet();

  const walletAddress = wallets[0]?.address ?? null;

  return {
    isReady,
    isAuthenticated: !!user,
    walletAddress,
    logout,
  };
}
