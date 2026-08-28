import type { IncomingMessage, ServerResponse } from "http";
import { randomBytes } from "crypto";
import { ethers } from "ethers";
import { ServerValue } from "firebase-admin/database";
import { buildSessionMessage } from "../../src/services/sessionMessage";
import { createSessionToken } from "../_lib/appSession";
import { adminDb } from "../_lib/firebaseAdmin";

type Req = IncomingMessage & { method?: string; body?: unknown; url?: string };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete sign-and-submit

/**
 * Issues our own signed session token for a wallet, replacing the old
 * Firebase-Anonymous-Auth-uid flow. The client signs buildSessionMessage()
 * with its embedded wallet; recovering the signer and checking it matches
 * walletAddress proves the caller actually controls that wallet's private
 * key. Every subsequent app->server call (meters, budget, relays,
 * notifications, directory, device pairing) presents this token instead of
 * a Firebase ID token, and never talks to Firebase directly at all -- only
 * this server does, via the Admin SDK.
 *
 * GET issues a one-time nonce the client must fetch first and sign into
 * the message; POST verifies that signature and mints the token. Folded
 * into this one route (dispatched on method) rather than a separate file
 * because Vercel's Hobby plan caps a deployment at 12 Serverless
 * Functions, and this project is already at that cap.
 *
 * The nonce closes a real gap the old static-message design had: a
 * captured signature over a message with no nonce proves wallet ownership
 * forever, with no expiry and no way to invalidate it -- a compromised
 * device, malicious app, or phishing page that got one signature could
 * mint fresh 30-day sessions indefinitely. A nonce is single-use (consumed
 * atomically below) and short-lived, so a captured signature is only ever
 * valid for the one already-spent nonce it was made over.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method === "GET") {
    await issueNonce(req, res);
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { walletAddress, signature, nonce } = (body ?? {}) as {
      walletAddress?: string;
      signature?: string;
      nonce?: string;
    };

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: "walletAddress must be a valid 0x address" });
      return;
    }
    if (!signature || typeof signature !== "string") {
      res.status(400).json({ error: "signature is required" });
      return;
    }
    if (!nonce || typeof nonce !== "string") {
      res.status(400).json({ error: "nonce is required -- call GET /api/session/create first" });
      return;
    }

    // Atomically consume the nonce: only the first request to present a
    // given nonce sees it validated, every subsequent one (a retried or
    // replayed request) finds it already gone. Validation happens inside
    // the transaction's update function so the check-and-delete is one
    // atomic step, not a separate read then a separate write.
    let nonceError: string | null = null;
    const key = walletAddress.toLowerCase();
    const nonceRef = adminDb().ref(`sessionNonces/${key}`);
    const claim = await nonceRef.transaction((current: { nonce: string; expiresAt: number } | null) => {
      if (!current) {
        nonceError = "No nonce issued for this wallet. Call GET /api/session/create first.";
        return current; // abort, nothing to consume
      }
      if (current.nonce !== nonce) {
        nonceError = "Invalid or already-used nonce. Request a fresh one and try again.";
        return; // abort -- leave a still-valid nonce untouched
      }
      if (Date.now() > current.expiresAt) {
        nonceError = "Nonce expired. Request a fresh one and try again.";
        return null; // consume it anyway so it can't be reused right up to expiry
      }
      nonceError = null;
      return null; // valid -- consume it
    });
    if (!claim.committed || nonceError) {
      res.status(401).json({ error: nonceError ?? "Invalid or already-used nonce. Request a fresh one and try again." });
      return;
    }

    const message = buildSessionMessage(walletAddress, nonce);
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

async function issueNonce(req: Req, res: Res): Promise<void> {
  const walletAddress = new URL(req.url ?? "", "http://localhost").searchParams.get("walletAddress");
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress must be a valid 0x address" });
    return;
  }

  try {
    const nonce = randomBytes(32).toString("hex");
    await adminDb().ref(`sessionNonces/${walletAddress.toLowerCase()}`).set({
      nonce,
      expiresAt: Date.now() + NONCE_TTL_MS,
      createdAt: ServerValue.TIMESTAMP,
    });
    res.status(200).json({ nonce, expiresIn: NONCE_TTL_MS });
  } catch (error) {
    console.error("session/create (nonce) failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
