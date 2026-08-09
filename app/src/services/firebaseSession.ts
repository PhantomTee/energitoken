import { Platform } from "react-native";
import { ethers } from "ethers";
import { signInAnonymously, signOut } from "firebase/auth";
import { ref, get } from "firebase/database";
import { auth, db } from "./firebase";
import { buildBindMessage } from "./bindMessage";

const BACKEND_URL = Platform.OS === "web" ? "" : process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app";

/**
 * Every /meters, /directory, and /walletToDevice read in the app goes
 * through an anonymous Firebase Auth session (see ensureFirebaseSession
 * below). If Anonymous sign-in isn't enabled for this Firebase project,
 * signInAnonymously() throws "Firebase: Error (auth/admin-restricted-
 * operation)." or "... (auth/operation-not-allowed)." -- a real SDK error,
 * not something this code can work around. Translate it into something
 * that says exactly what to do instead of surfacing the raw SDK string.
 */
function translateAnonymousAuthError(err: unknown): Error {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "auth/admin-restricted-operation" || code === "auth/operation-not-allowed") {
    return new Error(
      "Anonymous sign-in isn't enabled for this Firebase project. In the Firebase Console: Authentication → Sign-in method → Anonymous → Enable."
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Binds this device's Firebase Anonymous Auth session to the given wallet
 * address, via a write-once /uidToWallet/{uid} entry. The security rules
 * for /meters and /directory key off this binding.
 *
 * The binding itself is written server-side (app/api/session/bind.ts) after
 * verifying a signature from the wallet -- Anonymous Auth alone proves
 * nothing about which wallet a session should be trusted for (anyone can
 * sign in anonymously for free), so `getSigner` is required to produce that
 * proof. `getSigner` matches the shape of useWallet().getSigner().
 *
 * Handles the edge case where a stale anonymous session (from a previous Privy
 * user) is already bound to a different wallet — signs out and creates a fresh
 * session so the new wallet can bind cleanly.
 *
 * Safe to call on every screen mount: it's a no-op once the binding exists.
 */
export async function ensureFirebaseSession(
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<void> {
  const uid = await getOrCreateUid();
  await bindUidToWallet(uid, walletAddress, getSigner);
}

async function getOrCreateUid(): Promise<string> {
  if (auth.currentUser) return auth.currentUser.uid;
  try {
    return (await signInAnonymously(auth)).user.uid;
  } catch (err) {
    throw translateAnonymousAuthError(err);
  }
}

async function bindUidToWallet(
  uid: string,
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<void> {
  const bindingRef = ref(db, `uidToWallet/${uid}`);
  const snapshot = await get(bindingRef);

  if (snapshot.exists()) {
    if (snapshot.val() === walletAddress) {
      return; // Already correctly bound — nothing to do.
    }

    // Stale anonymous session bound to a different wallet (e.g. previous user on
    // this browser). Sign out, get a fresh anonymous UID, and bind the new one.
    await signOut(auth);
    let freshUid: string;
    try {
      freshUid = (await signInAnonymously(auth)).user.uid;
    } catch (err) {
      throw translateAnonymousAuthError(err);
    }
    await signAndBind(freshUid, walletAddress, getSigner);
    return;
  }

  await signAndBind(uid, walletAddress, getSigner);
}

/**
 * On web, getSigner() reads from Privy's useWallets(), which can lag a beat
 * behind `user` becoming ready right after login/cold-start -- the one place
 * this binding now runs earlier than before (previously it only needed a
 * plain write, no signer). A few short retries covers that startup race
 * without resorting to an arbitrary fixed delay.
 */
async function getSignerWithRetry(getSigner: () => Promise<ethers.Signer>): Promise<ethers.Signer> {
  const attempts = 5;
  const delayMs = 400;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await getSigner();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Wallet signer not available");
}

async function signAndBind(
  uid: string,
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<void> {
  const signer = await getSignerWithRetry(getSigner);
  const message = buildBindMessage(uid, walletAddress);
  const signature = await signer.signMessage(message);

  const response = await fetch(`${BACKEND_URL}/api/session/bind`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, walletAddress, signature }),
  });

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? `Failed to bind session (${response.status})`);
  }
}

/** Call on Privy logout so the next user gets a clean Firebase anonymous session. */
export async function clearFirebaseSession(): Promise<void> {
  if (auth.currentUser) {
    await signOut(auth);
  }
}
