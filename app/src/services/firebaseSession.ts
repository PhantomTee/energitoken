import { signInAnonymously } from "firebase/auth";
import { ref, get, set } from "firebase/database";
import { auth, db } from "./firebase";

/**
 * Binds this device's Firebase Anonymous Auth session to the given wallet
 * address, via a write-once /uidToWallet/{uid} entry. The security rules
 * for /meters and /directory key off this binding (see firebase/database.rules.json),
 * since Privy -- not Firebase Auth -- owns wallet identity.
 *
 * Safe to call on every screen mount: it's a no-op once the binding exists.
 */
export async function ensureFirebaseSession(walletAddress: string): Promise<void> {
  const uid = auth.currentUser?.uid ?? (await signInAnonymously(auth)).user.uid;

  const bindingRef = ref(db, `uidToWallet/${uid}`);
  const snapshot = await get(bindingRef);

  if (!snapshot.exists()) {
    await set(bindingRef, walletAddress);
  } else if (snapshot.val() !== walletAddress) {
    // Rules forbid rebinding a session to a different wallet -- this would only
    // happen if local Firebase auth state survived a Privy logout/login as a
    // different user. Surface it rather than silently failing downstream reads.
    throw new Error("This device session is already bound to a different wallet.");
  }
}
