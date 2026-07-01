import { usePrivy, useWallets } from "@privy-io/react-auth";
import { ethers } from "ethers";

export function useWallet() {
  const { user, ready, logout } = usePrivy();
  const { wallets } = useWallets();

  // Derive wallet address from user.linkedAccounts — available immediately once
  // Privy is ready, without waiting for useWallets() to connect the wallet.
  // useWallets() only lists actively-connected wallets which requires async
  // initialization and is always empty for returning users on first render.
  const embeddedAccount = (user?.linkedAccounts ?? []).find(
    (a: any) => a.type === "wallet" && a.walletClientType === "privy"
  );
  const walletAddress: string | null = (embeddedAccount as any)?.address ?? null;

  const email = user?.email?.address ?? null;

  // For signing transactions we need the live connected wallet from useWallets().
  // By the time a user initiates a transfer/top-up the wallet will be connected.
  const getSigner = async (): Promise<ethers.Signer> => {
    const connected = wallets.find((w) => w.walletClientType === "privy");
    if (!connected) throw new Error("Embedded wallet not connected yet");
    const eip1193Provider = await connected.getEthereumProvider();
    const browserProvider = new ethers.BrowserProvider(eip1193Provider);
    return browserProvider.getSigner();
  };

  return {
    isReady: ready,
    isAuthenticated: !!user,
    walletAddress,
    email,
    getSigner,
    logout,
  };
}
