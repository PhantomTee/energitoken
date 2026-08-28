import type { IncomingMessage, ServerResponse } from "http";
import { createHmac, timingSafeEqual } from "crypto";
import { ethers } from "ethers";
import { adminDb, deviceIdForWallet } from "../_lib/firebaseAdmin";
import { sendNotification } from "../_lib/notify";
import { getSpendableBalanceServer } from "../_lib/engyReads";

// Body parsing must be off: signature verification needs the exact raw
// bytes Alchemy signed, not a re-serialized JSON.stringify of a parsed
// object, which can differ in whitespace/key order and would never match.
export const config = { api: { bodyParser: false } };

type Req = IncomingMessage & { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Closes the gap described in the M2/backend-job discussion: nothing
 * server-side used to watch the chain for Transfer events, so a recipient's
 * meter only ever heard about incoming ENGY whenever their own phone's
 * Dashboard/Budget/Transfer screen happened to focus or poll. This endpoint
 * reacts to the event itself -- independent of either wallet's app being
 * open -- and does two things per transfer: mirrors both sides' fresh
 * spendable balance into Firebase (same field the client's own
 * setMeterTokenBalance writes, just written server-side here), and sends a
 * genuine "energy received" push notification to the recipient, the same
 * way oracle/burn.ts already does for consumption.
 *
 * Deliberately does NOT trust the webhook payload's value for anything
 * other than "which wallets were involved, go check" -- the actual balance
 * written is always re-read live from the chain via getSpendableBalanceServer,
 * same as the client does. This also means a duplicate webhook delivery
 * (Alchemy, like Flutterwave, doesn't guarantee exactly-once) is harmless
 * on the balance-mirror side -- re-writing the same current balance twice
 * is a no-op. It is NOT harmless on the notification side: a duplicate
 * delivery would send a second "energy received" push for the same
 * transfer. Accepted for now as a minor UX nuisance, not a correctness or
 * money-safety issue (unlike the mint/burn paths, which do need real
 * idempotency guards) -- worth a dedup check later if it turns out to
 * matter in practice.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const signingKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    console.error("transfer-webhook: missing ALCHEMY_WEBHOOK_SIGNING_KEY");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawBody = await readRawBody(req);
  const sigHeader = req.headers["x-alchemy-signature"];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

  if (!verifySignature(rawBody, signature, signingKey)) {
    console.error("transfer-webhook: invalid or missing x-alchemy-signature header");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const events = extractTransferEvents(payload);

  try {
    const db = adminDb();

    // Mirror every touched wallet's fresh spendable balance -- both sides
    // of a P2P transfer, and whichever side is paired for a mint/burn.
    const touchedWallets = new Set<string>();
    for (const event of events) {
      if (event.from !== ZERO_ADDRESS) touchedWallets.add(event.from);
      if (event.to !== ZERO_ADDRESS) touchedWallets.add(event.to);
    }
    for (const wallet of touchedWallets) {
      const deviceId = await deviceIdForWallet(wallet);
      if (!deviceId) continue; // not a paired household, nothing to mirror
      const spendable = await getSpendableBalanceServer(wallet);
      await db.ref(`meters/${deviceId}/tokenBalance`).set(Number(spendable));
    }

    // Notify only real peer-to-peer transfers' recipients -- not mint
    // (from == zero address, already gets a "Top-up complete" notification
    // from payments/callback.ts) and not burn (to == zero address, already
    // gets a "consumption" notification from oracle/burn.ts).
    for (const event of events) {
      if (event.from === ZERO_ADDRESS || event.to === ZERO_ADDRESS) continue;
      const deviceId = await deviceIdForWallet(event.to);
      if (!deviceId) continue;
      const units = (Number(event.valueWh) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
      await sendNotification(event.to, {
        type: "transfer",
        title: "Energy received",
        body: `${units} unit${event.valueWh === 1000n ? "" : "s"} received.`,
      });
    }

    res.status(200).json({ ok: true, processed: events.length });
  } catch (error) {
    console.error("transfer-webhook failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}

async function readRawBody(req: Req): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Alchemy signs every webhook the same way regardless of type: HMAC-SHA256
 * of the raw request body, hex-encoded, in X-Alchemy-Signature. This part
 * is safe to build ahead of picking a webhook type. */
function verifySignature(rawBody: string, signature: string | undefined, signingKey: string): boolean {
  if (!signature) return false;
  const expectedHex = createHmac("sha256", signingKey).update(rawBody, "utf8").digest("hex");
  const expected = Buffer.from(expectedHex, "utf8");
  const got = Buffer.from(signature, "utf8");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

type TransferEvent = { from: string; to: string; valueWh: bigint };

type RawLog = { data?: string; topics?: string[] };

const TRANSFER_EVENT = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

/**
 * Decodes the Custom (GraphQL) webhook's block.logs entries into Transfer
 * events. Field names (data, topics, account.address, transaction.hash/index)
 * are taken from Alchemy's actual dashboard query template, not guessed.
 * The envelope wrapping those logs (event.data.block.logs, alongside
 * webhookId/id/createdAt/type at the top level) is the one part not yet
 * confirmed against a real delivered payload -- worth double-checking
 * against the first real delivery this receives.
 *
 * ethers' own ABI decoding is used rather than manually slicing topics/data
 * (topics[1]/topics[2] are the indexed from/to, left-padded to 32 bytes;
 * data holds the non-indexed uint256 value) -- it's the same decode path
 * this project already trusts elsewhere and handles checksumming for free.
 */
function extractTransferEvents(payload: unknown): TransferEvent[] {
  const envelope = payload as { event?: { data?: { block?: { logs?: RawLog[] } } } };
  const block = envelope.event?.data?.block;
  if (!block) {
    // The one part of the envelope not yet confirmed against a real
    // delivery -- if this fires, the top-level shape differs from
    // Alchemy's documented `event.data.block.logs` and needs a look at
    // the actual payload logged here.
    console.error("transfer-webhook: unexpected payload envelope", JSON.stringify(payload).slice(0, 2000));
    return [];
  }
  const logs = block.logs ?? [];

  const events: TransferEvent[] = [];
  for (const log of logs) {
    if (!log.topics || !log.data) continue;
    let parsed: ethers.LogDescription | null;
    try {
      parsed = TRANSFER_EVENT.parseLog({ topics: log.topics, data: log.data });
    } catch {
      continue; // not a well-formed Transfer log -- skip rather than fail the whole batch
    }
    if (!parsed || parsed.name !== "Transfer") continue;
    events.push({
      from: ethers.getAddress(parsed.args[0] as string),
      to: ethers.getAddress(parsed.args[1] as string),
      valueWh: parsed.args[2] as bigint,
    });
  }
  return events;
}
