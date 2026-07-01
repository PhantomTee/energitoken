import { signInAnonymously, signOut } from "firebase/auth";
import { ref, get, set } from "firebase/database";
import { auth, db } from "./firebase";

/**
 * Binds this device's Firebase Anonymous Auth session to the given wallet
 * address, via a write-once /uidToWallet/{uid} entry. The security rules
 * for /meters and /directory key off this binding.
 *
 * Handles the edge case where a stale anonymous session (from a previous Privy
 * user) is already bound to a different wallet — signs out and creates a fresh
 * session so the new wallet can bind cleanly.
 *
 * Safe to call on every screen mount: it's a no-op once the binding exists.
 */
export async function ensureFirebaseSession(walletAddress: string): Promise<void> {
  const uid = await getOrCreateUid();
  await bindUidToWallet(uid, walletAddress);
}

async function getOrCreateUid(): Promise<string> {
  if (auth.currentUser) return auth.currentUser.uid;
  return (await signInAnonymously(auth)).user.uid;
}

async function bindUidToWallet(uid: string, walletAddress: string): Promise<void> {
  const bindingRef = ref(db, `uidToWallet/${uid}`);
  const snapshot = await get(bindingRef);

  if (!snapshot.exists()) {
    await set(bindingRef, walletAddress);
    return;
  }

  if (snapshot.val() === walletAddress) {
    return; // Already correctly bound — nothing to do.
  }

  // Stale anonymous session bound to a different wallet (e.g. previous user on
  // this browser). Sign out, get a fresh anonymous UID, and bind the new one.
  await signOut(auth);
  const freshUid = (await signInAnonymously(auth)).user.uid;
  await set(ref(db, `uidToWallet/${freshUid}`), walletAddress);
}

/** Call on Privy logout so the next user gets a clean Firebase anonymous session. */
export async function clearFirebaseSession(): Promise<void> {
  if (auth.currentUser) {
    await signOut(auth);
  }
}
