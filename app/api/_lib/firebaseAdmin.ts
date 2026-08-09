import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getAuth } from "firebase-admin/auth";

/**
 * Vercel functions are stateless and can't read a local serviceAccountKey.json
 * file, so the service account is supplied as three separate env vars instead
 * (set in the Vercel project settings, never committed).
 */
function getAdminApp() {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!projectId || !clientEmail || !privateKey || !databaseURL) {
    throw new Error(
      "Missing Firebase admin env vars (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL)"
    );
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    databaseURL,
  });
}

export type PaymentOrderStatus = "initial" | "failed" | "minting" | "minted" | "mint_failed";

export type PaymentOrder = {
  walletAddress: string;
  amountNgn: number;
  whAmount: number;
  status: PaymentOrderStatus;
  /** Flutterwave's own transaction id, assigned once payment completes (from the webhook or a verify call) — not known at order creation. */
  flwTransactionId?: number;
  mintTxHash?: string;
  createdAt: number;
  updatedAt: number;
};

/** Raw Admin database reference — use for paths not exposed via a named helper. */
export function adminDb() {
  return getDatabase(getAdminApp());
}

/**
 * Verifies a client's Firebase ID token (from its Anonymous Auth session)
 * and returns the caller's *trusted* wallet address by looking up
 * /uidToWallet/{uid} via the Admin SDK -- bypassing the read rule, but that's
 * fine here since we're reading the caller's own binding on their behalf.
 *
 * This is the trust chain server endpoints (devices/claim, devices/unbind)
 * use instead of trusting a walletAddress the client puts in the request
 * body: the ID token proves which uid is calling, and uidToWallet is only
 * ever written by app/api/session/bind.ts after a signature proves that uid
 * really is bound to that wallet. Throws on a missing/invalid/expired token
 * or a uid with no binding yet -- callers should turn that into a 401.
 */
export async function walletFromAuthHeader(authorizationHeader: string | undefined): Promise<string> {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : null;
  if (!token) throw new Error("Missing Authorization: Bearer <idToken> header");

  const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
  const snap = await adminDb().ref(`uidToWallet/${decoded.uid}`).get();
  if (!snap.exists()) throw new Error("This session isn't bound to a wallet yet");

  return snap.val() as string;
}

/** /orders is only ever touched by server functions via Admin SDK. */
export function ordersRef() {
  return getDatabase(getAdminApp()).ref("orders");
}
