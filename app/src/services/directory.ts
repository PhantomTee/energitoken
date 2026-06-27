import { ref, get, set } from "firebase/database";
import { db } from "./firebase";

/**
 * Firebase Realtime Database keys can't contain '.', so emails are stored
 * with '.' replaced by ',' -- a simple, reversible encoding (see firebase/schema.md).
 */
function encodeEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ",");
}

/** Called once after login so others can find this wallet by email. */
export async function writeDirectoryEntry(email: string, walletAddress: string): Promise<void> {
  const entryRef = ref(db, `directory/${encodeEmailKey(email)}`);
  const snapshot = await get(entryRef);
  if (!snapshot.exists()) {
    await set(entryRef, walletAddress);
  }
}

/** Resolves a recipient email to a wallet address, or null if not found. */
export async function resolveEmailToAddress(email: string): Promise<string | null> {
  const entryRef = ref(db, `directory/${encodeEmailKey(email)}`);
  const snapshot = await get(entryRef);
  return snapshot.exists() ? (snapshot.val() as string) : null;
}
