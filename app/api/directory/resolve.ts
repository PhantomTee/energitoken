import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";
import { walletFromBearer } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; url?: string; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

function encodeEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ",");
}

/**
 * Resolves a recipient email to a wallet address for Transfer -- server-side
 * replacement for src/services/directory.ts's resolveEmailToAddress().
 * Requires a valid session (any signed-in user can look up a recipient) but
 * no device-ownership check, since this isn't the caller's own data.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    walletFromBearer(req.headers.authorization as string | undefined);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Unauthorized" });
    return;
  }

  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const email = url.searchParams.get("email");
    if (!email) {
      res.status(400).json({ error: "email query param is required" });
      return;
    }

    const snap = await adminDb().ref(`directory/${encodeEmailKey(email)}`).get();
    res.status(200).json({ walletAddress: snap.exists() ? (snap.val() as string) : null });
  } catch (error) {
    console.error("directory/resolve failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
