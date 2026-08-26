import type { IncomingMessage, ServerResponse } from "http";
import { adminDb } from "../_lib/firebaseAdmin";
import { walletFromBearer } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/** Firebase Realtime Database keys can't contain '.', so emails are stored
 * with '.' replaced by ',' (see firebase/schema.md). */
function encodeEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ",");
}

/**
 * Registers "this email resolves to this wallet" so Transfer's recipient
 * lookup can find people by email -- server-side replacement for
 * src/services/directory.ts's writeDirectoryEntry(). The wallet is derived
 * from the caller's session token, never trusted from the request body.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let walletAddress: string;
  try {
    walletAddress = walletFromBearer(req.headers.authorization as string | undefined);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Unauthorized" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { email } = (body ?? {}) as { email?: string };
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "email is required" });
      return;
    }

    const entryRef = adminDb().ref(`directory/${encodeEmailKey(email)}`);
    const snap = await entryRef.get();
    if (!snap.exists()) {
      await entryRef.set(walletAddress);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("directory/register failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
