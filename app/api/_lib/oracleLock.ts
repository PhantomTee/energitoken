import { randomUUID } from "crypto";
import { adminDb } from "./firebaseAdmin";

const LOCK_PATH = "oracleLock";
// Long enough to cover a bulk run across every paired device, short enough
// that a holder that crashed mid-run doesn't wedge every future run for
// more than a few minutes.
const LOCK_TTL_MS = 5 * 60 * 1000;

/**
 * Serializes every oracle write (set-pending, burn, cycle-tick) through one
 * global lock. All three mutate overlapping state for the same wallets --
 * pendingBurn, burnCheckpoints, cycleStartedAt -- and since the workflow
 * now runs all three together on every cron firing (see
 * .github/workflows/burn-oracle.yml), plus a manual workflow_dispatch can
 * still land while a scheduled run is in flight, two oracle runs could
 * otherwise interleave writes: burnConsumed() clearing pendingBurn while a
 * concurrent set-pending run overwrites it with a stale pre-burn figure,
 * or two burn runs both reading the same pre-burn checkpoint and both
 * burning the same consumption.
 *
 * Returns `{ ok: false }` immediately (never throws, never waits) if
 * another run currently holds the lock -- the caller returns a 423 rather
 * than blocking a serverless invocation on a lock that might not clear for
 * minutes. A stale lock (holder crashed before releasing) is reclaimable
 * once LOCK_TTL_MS has passed.
 */
export async function withOracleLock<T>(fn: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false }> {
  const holder = randomUUID();
  const ref = adminDb().ref(LOCK_PATH);
  const now = Date.now();

  const claim = await ref.transaction((current: { holder: string; expiresAt: number } | null) => {
    if (current && current.expiresAt > now) return; // held, not expired -- abort
    return { holder, expiresAt: now + LOCK_TTL_MS };
  });
  if (!claim.committed) {
    return { ok: false };
  }

  try {
    const result = await fn();
    return { ok: true, result };
  } finally {
    // Release only if this run still owns the lock -- a run slow enough to
    // outlast LOCK_TTL_MS may have already had the lock reclaimed by a
    // later run (a different holder id), which must not be cleared here.
    await ref.transaction((current: { holder: string; expiresAt: number } | null) => {
      if (current && current.holder === holder) return null;
      return; // abort -- not ours any more, leave it alone
    });
  }
}
