import type { IncomingMessage, ServerResponse } from "http";
import { ethers } from "ethers";
import { buildSessionMessage } from "../../src/services/sessionMessage";
import { createSessionToken } from "../_lib/appSession";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Issues our own signed session token for a wallet, replacing the old
 * Firebase-Anonymous-Auth-uid flow. The client signs buildSessionMessage()
 * with its embedded wallet; recovering the signer and checking it matches
 * walletAddress proves the caller actually controls that wallet's private
 * key. Every subsequent app->server call (meters, budget, relays,
 * notifications, directory, device pairing) presents this token instead of
 * a Firebase ID token, and never talks to Firebase directly at all -- only
 * this server does, via the Admin SDK.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { walletAddress, signature } = (body ?? {}) as { walletAddress?: string; signature?: string };

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: "walletAddress must be a valid 0x address" });
      return;
    }
    if (!signature || typeof signature !== "string") {
      res.status(400).json({ error: "signature is required" });
      return;
    }

    const message = buildSessionMessage(walletAddress);
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
      res.status(401).json({ error: "Signature does not match walletAddress" });
      return;
    }

    const { token, expiresAt } = createSessionToken(walletAddress);
    res.status(200).json({ token, expiresAt });
  } catch (error) {
    console.error("session/create failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
