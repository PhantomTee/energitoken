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
      if (resource === "consumption") return await getConsumption(req, res, walletAddress);
      if (resource === "dailyUsage") return await getDailyUsage(req, res, walletAddress);
      res.status(400).json({ error: "resource must be one of meters, notifications, directory, burnHistory, consumption, dailyUsage" });
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

const WAT_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST -- the deployment's zone

/** YYYYMMDD in West Africa Time, matching the day keys the firmware writes
 * under /meterHistory/{deviceId} (see pushHistory() in the .ino, which keys
 * samples by its own localtime with TZ fixed to WAT-1). */
function watDayKey(epochMs: number): string {
  return new Date(epochMs + WAT_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, "");
}

/** Buckets and windows offered to the chart. Each range is paired with a
 * bucket chosen so the payload stays small and the line stays readable:
 * a full day at one-minute resolution would be 1,440 points, most of which
 * land on the same pixel column. */
const CONSUMPTION_RANGES: Record<string, { hours: number; bucketMin: number }> = {
  "1h":  { hours: 1,        bucketMin: 1 },
  "6h":  { hours: 6,        bucketMin: 2 },
  "24h": { hours: 24,       bucketMin: 10 },
  "7d":  { hours: 24 * 7,   bucketMin: 60 },
  "14d": { hours: 24 * 14,  bucketMin: 180 },
};

/**
 * A window of the meter's own consumption log, bucketed for display.
 *
 * The firmware writes one row a minute under a WAT day key, each holding
 * instantaneous watts and the LIFETIME energy register. Average power across
 * a bucket is derived from the energy delta across it rather than by
 * averaging the spot readings: a once-a-minute instantaneous sample aliases
 * badly against appliances that cycle, while the energy counter integrates
 * everything that happened in between and cannot miss a load that ran
 * entirely between two samples.
 *
 * Points carry absolute epoch milliseconds rather than a minute-of-day, so a
 * range spanning several days plots on one continuous axis.
 *
 * Gaps stay gaps. A bucket the meter was offline for is simply absent from
 * the result, and the chart breaks its line there rather than drawing
 * through hours nobody measured.
 */
async function getConsumption(req: Req, res: Res, walletAddress: string): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const rangeKey = url.searchParams.get("range") ?? "24h";
  const range = CONSUMPTION_RANGES[rangeKey];
  if (!range) {
    res.status(400).json({ error: `range must be one of ${Object.keys(CONSUMPTION_RANGES).join(", ")}` });
    return;
  }

  const deviceId = await deviceIdForWallet(walletAddress);
  if (!deviceId) {
    res.status(200).json({ hasDevice: false, range: rangeKey, points: [], totalWh: 0, peakW: 0 });
    return;
  }

  const now = Date.now();
  const startMs = now - range.hours * 60 * 60 * 1000;

  // Every WAT day the window touches, oldest first. Reading whole day nodes
  // and filtering in memory is cheaper than a query per bucket, and a day is
  // at most 1,440 small rows.
  const dayKeys: string[] = [];
  for (let t = startMs; ; t += 24 * 60 * 60 * 1000) {
    const k = watDayKey(Math.min(t, now));
    if (!dayKeys.includes(k)) dayKeys.push(k);
    if (t >= now) break;
  }

  const db = adminDb();
  type Row = { t: number; w: number; e: number | null };
  const rows: Row[] = [];
  for (const day of dayKeys) {
    const snap = await db.ref(`meterHistory/${deviceId}/${day}`).get();
    if (!snap.exists()) continue;
    const raw = snap.val() as Record<string, { w?: number; e?: number }>;
    // The key is local WAT HHMM on that WAT date; convert back to absolute ms.
    const dayStartMs = Date.UTC(
      Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))
    ) - WAT_OFFSET_MS;
    for (const [hhmm, v] of Object.entries(raw)) {
      if (!/^\d{4}$/.test(hhmm)) continue;
      const minute = parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(2), 10);
      if (minute < 0 || minute >= 1440) continue;
      rows.push({
        t: dayStartMs + minute * 60_000,
        w: typeof v.w === "number" ? v.w : 0,
        e: typeof v.e === "number" ? v.e : null,
      });
    }
  }
  rows.sort((a, b) => a.t - b.t);

  const windowed = rows.filter((r) => r.t >= startMs && r.t <= now);

  // Average power per bucket from the energy delta across it. A negative
  // delta means the meter's counter was reset inside the bucket (a manual
  // reset, or the module replaced), which is not consumption -- fall back to
  // the mean spot reading for that bucket rather than plotting a negative.
  const bucketMs = range.bucketMin * 60_000;
  const buckets = new Map<number, Row[]>();
  for (const r of windowed) {
    const key = Math.floor(r.t / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  const points = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, group]) => {
      const spotMean = group.reduce((s, g) => s + g.w, 0) / group.length;
      let avgW = spotMean;
      const withE = group.filter((g) => g.e !== null);
      if (withE.length >= 2) {
        const dWh = (withE[withE.length - 1].e as number) - (withE[0].e as number);
        const dMin = (withE[withE.length - 1].t - withE[0].t) / 60_000;
        if (dMin > 0 && dWh >= 0) avgW = (dWh / dMin) * 60;
      }
      return { t, avgW: Math.round(avgW * 10) / 10, w: Math.round(spotMean * 10) / 10 };
    });

  // Total across the window, from the first to the last energy reading that
  // actually exists -- not a sum of the buckets, which would silently count
  // an outage as zero rather than as unknown.
  const withEnergy = windowed.filter((r) => r.e !== null);
  const totalWh =
    withEnergy.length >= 2
      ? Math.max(0, (withEnergy[withEnergy.length - 1].e as number) - (withEnergy[0].e as number))
      : 0;

  res.status(200).json({
    hasDevice: true,
    range: rangeKey,
    bucketMin: range.bucketMin,
    startMs,
    endMs: now,
    points,
    totalWh: Math.round(totalWh),
    peakW: points.length ? Math.max(...points.map((p) => p.avgW)) : 0,
  });
}

/**
 * Measured consumption per WAT calendar day, for the Budget screen's usage
 * bars and its runway projection.
 *
 * Both used to be built from burnHistory -- the log of settled ON-CHAIN
 * burns. That is the wrong source for "how much did this household use".
 * A burn entry only exists once the oracle has run AND had a positive delta
 * to settle, so the log is sparse and lags reality by however long the cron
 * takes; when the oracle lock wedged for three days it recorded nothing at
 * all, and both charts simply went blank. Today's bar was almost always
 * empty even in normal operation, because today's consumption had not been
 * settled yet.
 *
 * meterHistory is what the meter actually measured, written every minute
 * whether or not anything has been burned, so a day's usage is available the
 * moment it happens rather than hours later.
 *
 * A day's total is the sum of POSITIVE deltas between consecutive samples,
 * not simply last minus first. The lifetime counter can be reset mid-day
 * (see performEnergyReset in the firmware) or the module replaced, and
 * last-minus-first across such a day would report a large negative and clamp
 * to zero, silently discarding everything used before the reset.
 */
async function getDailyUsage(req: Req, res: Res, walletAddress: string): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days") ?? 7) || 7));

  const deviceId = await deviceIdForWallet(walletAddress);
  if (!deviceId) {
    res.status(200).json({ hasDevice: false, days: [] });
    return;
  }

  const db = adminDb();
  const out: { day: string; wh: number }[] = [];
  const now = Date.now();

  for (let i = days - 1; i >= 0; i--) {
    const key = watDayKey(now - i * 24 * 60 * 60 * 1000);
    const snap = await db.ref(`meterHistory/${deviceId}/${key}`).get();
    let wh = 0;
    if (snap.exists()) {
      const raw = snap.val() as Record<string, { e?: number }>;
      const energies = Object.entries(raw)
        .filter(([hhmm, v]) => /^\d{4}$/.test(hhmm) && typeof v.e === "number")
        .map(([hhmm, v]) => ({
          minute: parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(2), 10),
          e: v.e as number,
        }))
        .sort((a, b) => a.minute - b.minute);
      for (let k = 1; k < energies.length; k++) {
        const d = energies[k].e - energies[k - 1].e;
        if (d > 0) wh += d;
      }
    }
    out.push({ day: key, wh: Math.round(wh) });
  }

  res.status(200).json({ hasDevice: true, days: out });
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
