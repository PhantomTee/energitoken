import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

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

export type OpayOrderStatus = "initial" | "success" | "failed" | "minted";

export type OpayOrder = {
  walletAddress: string;
  amountNgn: number;
  whAmount: number;
  status: OpayOrderStatus;
  orderNo?: string;
  mintTxHash?: string;
  createdAt: number;
  updatedAt: number;
};

/** /orders is separate from /meters and /directory — it's only ever touched by these
 * trusted server functions via the Admin SDK, so it isn't covered by database.rules.json. */
export function ordersRef() {
  return getDatabase(getAdminApp()).ref("orders");
}
