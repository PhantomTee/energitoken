import type { IncomingMessage, ServerResponse } from "http";
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
      res.status(400).json({ error: "resource must be one of meters, notifications, directory" });
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { resource, action } = (body ?? {}) as { resource?: string; action?: string };

      if (resource === "meters" && action === "budget") return await setBudget(res, walletAddress, body);
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

function encodeEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ",");
}

async function resolveDirectory(req: Req, res: Res): Promise<void> {
  const email = new URL(req.url ?? "", "http://localhost").searchParams.get("email");
  if (!email) {
    res.status(400).json({ error: "email query param is required" });
    return;
  }
  const snap = await adminDb().ref(`directory/${encodeEmailKey(email)}`).get();
  res.status(200).json({ walletAddress: snap.exists() ? (snap.val() as string) : null });
}

async function registerDirectory(res: Res, walletAddress: string, body: unknown): Promise<void> {
  const { email } = (body ?? {}) as { email?: string };
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email is required" });
    return;
  }
  const entryRef = adminDb().ref(`directory/${encodeEmailKey(email)}`);
  const snap = await entryRef.get();
  if (!snap.exists()) await entryRef.set(walletAddress);
  res.status(200).json({ ok: true });
}
