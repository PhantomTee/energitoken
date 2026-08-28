import type { IncomingMessage, ServerResponse } from "http";
import { createHash } from "crypto";
import { ServerValue } from "firebase-admin/database";
import { adminDb, deviceIdForWallet } from "./_lib/firebaseAdmin";
import { walletFromBearer } from "./_lib/appSession";

type Req = IncomingMessage & { method?: string; body?: unknown; url?: string; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

const VALID_TIERS = new Set(["r1", "r2", "r3", "r4"]);

/**
 * Combines every read/write the app needs for meters, notifications, and
 * the email directory into one endpoint, dispatched by `resource` (query
 * param on GET, body field on POST) -- Vercel's Hobby plan caps a
 * deployment at 12 Serverless Functions, and this project went well past
 * that once the Firebase-Client-Auth removal added a separate endpoint per
 * former direct-Firebase call site. None of these three resources have an
 * external caller depending on their old individual paths (unlike
 * payments/callback.ts, a Flutterwave webhook URL, or the oracle/* cron
 * endpoints), so folding them together is the safe way to claw back
 * headroom instead of touching anything with an external dependency.
 */
export default async function handler(req: Req, res: Res) {
  let walletAddress: string;
  try {
    walletAddress = walletFromBearer(req.headers.authorization as string | undefined);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Unauthorized" });
    return;
  }

  try {
    if (req.method === "GET") {
      const resource = new URL(req.url ?? "", "http://localhost").searchParams.get("resource");
      if (resource === "meters") return await getMine(res, walletAddress);
      if (resource === "notifications") return await listNotifications(res, walletAddress);
      if (resource === "directory") return await resolveDirectory(req, res);
      if (resource === "burnHistory") return await getBurnHistory(res, walletAddress);
      res.status(400).json({ error: "resource must be one of meters, notifications, directory, burnHistory" });
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { resource, action } = (body ?? {}) as { resource?: string; action?: string };

      if (resource === "meters" && action === "budget") return await setBudget(res, walletAddress, body);
      if (resource === "meters" && action === "reset-budget") return await resetBudget(res, walletAddress);
      if (resource === "meters" && action === "token-balance") return await setTokenBalance(res, walletAddress, body);
      if (resource === "meters" && action === "relay-override") return await setRelayOverride(res, walletAddress, body);
      if (resource === "notifications" && action === "mark-read") return await markRead(res, walletAddress, body);
      if (resource === "notifications" && action === "push-token") return await savePushToken(res, walletAddress, body);
      if (resource === "directory" && action === "register") return await registerDirectory(res, walletAddress, body);

      res.status(400).json({ error: "Unrecognized resource/action combination" });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("api/data failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}

// ── meters ──────────────────────────────────────────────────────────────

async function getMine(res: Res, walletAddress: string): Promise<void> {
  const deviceId = await deviceIdForWallet(walletAddress);
  if (!deviceId) {
    res.status(200).json({ hasDevice: false });
    return;
  }
  const snap = await adminDb().ref(`meters/${deviceId}`).get();
  res.status(200).json({ hasDevice: true, deviceId, reading: snap.exists() ? snap.val() : null });
}

/** Read side of oracle/burn.ts's append-only burnHistory log -- see that
 * file's comment for why the chart needs this instead of scanning the
 * chain directly. No orderByChild/limitToLast here deliberately: that
 * needs a .indexOn rule this deploy doesn't have, and burns are infrequent
 * enough (gated behind the oracle's own cron) that even months of history
 * is a small, unbounded read. Order doesn't matter to the caller -- it
 * buckets entries by calendar day, not by arrival order. */
async function getBurnHistory(res: Res, walletAddress: string): Promise<void> {
  const deviceId = await deviceIdForWallet(walletAddress);
  if (!deviceId) {
    res.status(200).json({ entries: [] });
    return;
  }
  const snap = await adminDb().ref(`burnHistory/${deviceId}`).get();
  const entries: Array<{ deltaWh: number; timestamp: number }> = snap.exists()
    ? Object.values(snap.val() as Record<string, { deltaWh: number; timestamp: number }>)
    : [];
  res.status(200).json({ entries });
}

async function setBudget(res: Res, walletAddress: string, body: unknown): Promise<void> {
  const { budgetWh } = (body ?? {}) as { budgetWh?: number };
  if (typeof budgetWh !== "number" || !Number.isFinite(budgetWh) || budgetWh < 0) {
    res.status(400).json({ error: "budgetWh must be a non-negative number" });
    return;
  }
  const deviceId = await deviceIdForWallet(walletAddress);
  if (!deviceId) {
    res.status(404).json({ error: "No device paired to this wallet" });
    return;
  }
  await adminDb().ref(`meters/${deviceId}`).update({ budgetWh, cycleStartedAt: ServerValue.TIMESTAMP });
  res.status(200).json({ ok: true });
}

/**
 * Clears a device's budget entirely -- back to unrestricted (no automatic
 * shedding). budgetWh alone can't communicate that: pullConfig() only ever
 * accepts a fresh *positive* value and silently ignores the field being
 * absent or zero, by design (so a stale/failed write can't accidentally
 * zero out a real budget). budgetClearedAt is a dedicated edge-triggered
 * signal, same pattern as cycleStartedAt -- firmware compares it against
 * the last value it saw and reacts on change, not on presence. Also rolls
 * a fresh cycle and clears any relay overrides, so a reset genuinely
 * restores every relay to its normal (unshed, unforced) position.
 */
async function resetBudget(res: Res, walletAddress: string): Promise<void> {
  const deviceId = await deviceIdForWallet(walletAddress);
  if (!deviceId) {
    res.status(404).json({ error: "No device paired to this wallet" });
    return;
  }
  await adminDb().ref(`meters/${deviceId}`).update({
    budgetClearedAt: ServerValue.TIMESTAMP,
    cycleStartedAt: ServerValue.TIMESTAMP,
  });
  await adminDb().ref(`meters/${deviceId}/budgetWh`).remove();
  await adminDb().ref(`meters/${deviceId}/relayOverrides`).remove();
  res.status(200).json({ ok: true });
}

async function setTokenBalance(res: Res, walletAddress: string, body: unknown): Promise<void> {
  const { spendableWh } = (body ?? {}) as { spendableWh?: number };
  if (typeof spendableWh !== "number" || !Number.isFinite(spendableWh) || spendableWh < 0) {
    res.status(400).json({ error: "spendableWh must be a non-negative number" });
    return;
  }
  const deviceId = await deviceIdForWallet(walletAddress);
  if (!deviceId) {
    res.status(404).json({ error: "No device paired to this wallet" });
    return;
  }
  await adminDb().ref(`meters/${deviceId}/tokenBalance`).set(spendableWh);
  res.status(200).json({ ok: true });
}

async function setRelayOverride(res: Res, walletAddress: string, body: unknown): Promise<void> {
  const { tier, value } = (body ?? {}) as { tier?: string; value?: boolean | null };
  if (!tier || !VALID_TIERS.has(tier)) {
    res.status(400).json({ error: "tier must be one of r1, r2, r3, r4" });
    return;
  }
  if (value !== null && typeof value !== "boolean") {
    res.status(400).json({ error: "value must be a boolean or null" });
    return;
  }
  const deviceId = await deviceIdForWallet(walletAddress);
  if (!deviceId) {
    res.status(404).json({ error: "No device paired to this wallet" });
    return;
  }
  const overrideRef = adminDb().ref(`meters/${deviceId}/relayOverrides/${tier}`);
  if (value === null) await overrideRef.remove();
  else await overrideRef.set(value);
  res.status(200).json({ ok: true });
}

// ── notifications ───────────────────────────────────────────────────────

async function listNotifications(res: Res, walletAddress: string): Promise<void> {
  const snap = await adminDb().ref(`notifications/${walletAddress}`).orderByChild("createdAt").limitToLast(50).get();
  const items: Array<{ id: string; type: string; title: string; body: string; read: boolean; createdAt: number }> = [];
  snap.forEach((child) => {
    const value = child.val();
    items.push({
      id: child.key as string,
      type: value.type ?? "topup",
      title: value.title ?? "",
      body: value.body ?? "",
      read: !!value.read,
      createdAt: value.createdAt ?? 0,
    });
    return false;
  });
  items.sort((a, b) => b.createdAt - a.createdAt);
  res.status(200).json({ notifications: items });
}

async function markRead(res: Res, walletAddress: string, body: unknown): Promise<void> {
  const { ids } = (body ?? {}) as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(200).json({ ok: true });
    return;
  }
  const updates: Record<string, boolean> = {};
  for (const id of ids) {
    if (typeof id === "string" && id) updates[`notifications/${walletAddress}/${id}/read`] = true;
  }
  if (Object.keys(updates).length > 0) await adminDb().ref().update(updates);
  res.status(200).json({ ok: true });
}

async function savePushToken(res: Res, walletAddress: string, body: unknown): Promise<void> {
  const { expoPushToken } = (body ?? {}) as { expoPushToken?: string };
  if (!expoPushToken || typeof expoPushToken !== "string") {
    res.status(400).json({ error: "expoPushToken is required" });
    return;
  }
  const key = encodeURIComponent(expoPushToken);
  await adminDb().ref(`pushTokens/${walletAddress}/${key}`).set({ token: expoPushToken, updatedAt: Date.now() });
  res.status(200).json({ ok: true });
}

// ── directory ───────────────────────────────────────────────────────────

/**
 * Firebase Realtime Database keys can't contain '.', '#', '$', '[', or ']'.
 * The old encoding only replaced '.', so an email with any of the other
 * four characters in its local part (rare, but valid per RFC 5321) made
 * this call throw and the endpoint 500. A hash of the normalized address
 * sidesteps the whole reserved-character set instead of chasing each one
 * individually, at the cost of the key no longer being human-readable in
 * the Firebase console -- acceptable since nothing reads this key directly,
 * only computes it from an email to look up.
 *
 * Note: this changes the key an already-registered email hashes to, so an
 * existing directory entry written under the old '.'->',' scheme won't be
 * found by a lookup computed with this function alone. Self-healing in
 * practice: the Dashboard re-registers the caller's own email on every
 * login (dashboard.tsx's writeDirectoryEntry effect), which overwrites
 * nothing (registerDirectory only sets when unclaimed) but does create the
 * new-key entry going forward. Until that happens for a given user, though,
 * a lookup for their email would 404 for everyone else -- resolveDirectory
 * below falls back to the old key so lookups keep working during the
 * transition; only writes use the new scheme, so nothing new is ever
 * created under the vulnerable old key.
 */
function encodeEmailKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

/** Reproduces the pre-8ac7627 key scheme, read-only fallback for entries
 * written before the SHA-256 switch -- see encodeEmailKey's comment. */
function encodeEmailKeyLegacy(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ",");
}

async function resolveDirectory(req: Req, res: Res): Promise<void> {
  const email = new URL(req.url ?? "", "http://localhost").searchParams.get("email");
  if (!email) {
    res.status(400).json({ error: "email query param is required" });
    return;
  }
  const snap = await adminDb().ref(`directory/${encodeEmailKey(email)}`).get();
  if (snap.exists()) {
    res.status(200).json({ walletAddress: snap.val() as string });
    return;
  }
  const legacySnap = await adminDb().ref(`directory/${encodeEmailKeyLegacy(email)}`).get();
  res.status(200).json({ walletAddress: legacySnap.exists() ? (legacySnap.val() as string) : null });
}

/**
 * Known gap: this trusts whatever email string the caller's session sends,
 * not a Privy-verified claim that the session's wallet actually owns it --
 * verifying that server-side needs a Privy server credential (app secret or
 * verification key) this deployment doesn't have configured. The
 * legitimate client only ever sends its own Privy-reported email
 * (dashboard.tsx derives `email` from useWallet(), never a free-text
 * field), but a caller hitting this endpoint directly with a valid session
 * token and an arbitrary email string in the body isn't stopped by
 * anything here. Until a Privy identity check is wired in, this function
 * can only prevent a SECOND wallet from silently overwriting a FIRST
 * wallet's claim on the same email -- see the transaction below -- not
 * verify the first claim was legitimate to begin with.
 */
async function registerDirectory(res: Res, walletAddress: string, body: unknown): Promise<void> {
  const { email } = (body ?? {}) as { email?: string };
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email is required" });
    return;
  }
  const entryRef = adminDb().ref(`directory/${encodeEmailKey(email)}`);
  // Transactional claim-or-confirm, not read-then-write: two different
  // wallets registering the same email concurrently could otherwise both
  // read "unclaimed" before either writes, and the second write would
  // silently win with no error to either caller.
  const result = await entryRef.transaction((current: string | null) => {
    if (current === null) return walletAddress; // unclaimed -- claim it
    return; // already set (by this wallet or another) -- leave untouched, don't overwrite
  });
  const finalOwner = result.snapshot.val() as string;
  if (finalOwner !== walletAddress) {
    // Distinguishable from success -- the old code returned `{ ok: true }`
    // here too, silently telling a wallet its email registration "worked"
    // when it actually just lost a conflict to whoever claimed it first.
    res.status(409).json({ error: "This email is already registered to a different wallet." });
    return;
  }
  res.status(200).json({ ok: true });
}
