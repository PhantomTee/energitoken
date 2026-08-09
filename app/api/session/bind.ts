import type { IncomingMessage, ServerResponse } from "http";
import { ethers } from "ethers";
import { adminDb } from "../_lib/firebaseAdmin";
import { buildBindMessage } from "../../src/services/bindMessage";

type Req = IncomingMessage & { method?: string; body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/**
 * Binds a Firebase Anonymous Auth uid to a wallet address, with actual proof
 * of ownership -- the missing piece that made /uidToWallet spoofable before
 * this endpoint existed. Every other Firebase rule (meter reads, budgetWh
 * writes, relayOverrides) trusts whatever wallet a uid is bound to, so this
 * is the one place that binding is allowed to be created.
 *
 * The client signs `buildBindMessage(uid, walletAddress)` with its embedded
 * wallet (see src/services/firebaseSession.ts) and posts the signature here.
 * Recovering the signer and checking it matches walletAddress proves the
 * caller actually controls that wallet's private key -- something a plain
 * Firebase write (the old approach) could never establish, since Anonymous
 * Auth is free and requires no identity at all.
 *
 * Write-once per uid, same as the rule this replaces: if the uid is already
 * bound to a *different* wallet, this rejects rather than overwriting --
 * matches the existing client-side "stale session -> sign out, get a fresh
 * uid" recovery path in firebaseSession.ts.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { uid, walletAddress, signature } = (body ?? {}) as {
      uid?: string;
      walletAddress?: string;
      signature?: string;
    };

    if (!uid || typeof uid !== "string") {
      res.status(400).json({ error: "uid is required" });
      return;
    }
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: "walletAddress must be a valid 0x address" });
      return;
    }
    if (!signature || typeof signature !== "string") {
      res.status(400).json({ error: "signature is required" });
      return;
    }

    const message = buildBindMessage(uid, walletAddress);
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

    const db = adminDb();
    const bindingRef = db.ref(`uidToWallet/${uid}`);
    const existingSnap = await bindingRef.get();

    if (existingSnap.exists() && existingSnap.val() !== walletAddress) {
      res.status(409).json({ error: "This session is already bound to a different wallet" });
      return;
    }

    if (!existingSnap.exists()) {
      await bindingRef.set(walletAddress);
    }

    res.status(200).json({ ok: true, uid, walletAddress });
  } catch (error) {
    console.error("session/bind failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
