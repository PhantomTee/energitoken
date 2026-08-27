import { useCallback } from "react";
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
  // Fallback chain: linkedAccounts → user.wallet (Privy's primary-wallet field)
  // → the connected wallet list. Any one of them knowing the address is enough.
  const walletAddress: string | null =
    (embeddedAccount as any)?.address ??
    user?.wallet?.address ??
    wallets.find((w) => w.walletClientType === "privy")?.address ??
    null;

  const email = user?.email?.address ?? null;

  // For signing transactions we need the live connected wallet from useWallets().
  // By the time a user initiates a transfer/top-up the wallet will be connected.
  //
  // Must match on address, not just take the first walletClientType==="privy"
  // entry -- walletAddress (above) comes from user.linkedAccounts, which
  // updates as soon as Privy confirms the account/wallet, while useWallets()'s
  // connected-wallet list is a separately-timed async connection that can lag
  // behind, especially right after creating a brand-new account. Taking
  // "whatever's first in the list" during that gap could silently return a
  // signer for a different wallet than walletAddress claims -- it would sign
  // successfully, just for the wrong address, and /api/session/create would
  // correctly reject the mismatch with a 401 that looks like a network
  // problem but isn't. Requiring the address match converts that into a
  // clean "not connected yet" throw, which the caller's retry loop
  // (getSignerWithRetry in firebaseSession.ts) already handles correctly.
  // Memoized: an unstable getSigner (a fresh closure every render, which
  // this was before) becomes a fresh reference in every useCallback/
  // useEffect elsewhere in the app that lists it as a dependency (Dashboard's
  // refreshBalance, Budget's, Transfer's...) -- and those screens already
  // re-render on their own 1s clock ticks, so an unstable getSigner cascaded
  // into those effects re-arming and re-firing (including real network
  // calls: session token, balance, meter data) far more often than an
  // actual focus/mount event, not just once per intended trigger.
  const getSigner = useCallback(async (): Promise<ethers.Signer> => {
    const connected = walletAddress
      ? wallets.find(
          (w) => w.walletClientType === "privy" && w.address?.toLowerCase() === walletAddress.toLowerCase()
        )
      : wallets.find((w) => w.walletClientType === "privy");
    if (!connected) throw new Error("Embedded wallet not connected yet");
    const eip1193Provider = await connected.getEthereumProvider();
    const browserProvider = new ethers.BrowserProvider(eip1193Provider);
    return browserProvider.getSigner();
  }, [wallets, walletAddress]);

  return {
    isReady: ready,
    isAuthenticated: !!user,
    walletAddress,
    email,
    getSigner,
    logout,
  };
}
