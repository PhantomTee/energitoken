import { ethers } from "ethers";
import { getReadContract, getReadProvider } from "./contract";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type TxDirection = "mint" | "transfer-in" | "transfer-out" | "burn";

export type TxRecord = {
  hash: string;
  direction: TxDirection;
  amountWh: number;
  counterparty: string;
  timestamp: number;
};

/**
 * The public Amoy RPC caps eth_getLogs at a 100-block range per call (most
 * public RPCs cap somewhere; this one is unusually strict) -- querying from
 * block 0 throws "block range exceeds configured limit" regardless of how
 * young the contract is. MAX_LOOKBACK_BLOCKS bounds how far back a single
 * history load will scan; a long-lived deployment would need an indexer
 * instead of scanning logs from the client at all.
 *
 * The same endpoint also rate-limits per IP across a rolling window (a
 * Cloudflare 429, not tied to any single call's concurrency) -- so this
 * stays conservative on both chunk count and concurrency, with a couple of
 * backoff retries per chunk, rather than maximizing for speed.
 */
const CHUNK_SIZE = 100;
const MAX_LOOKBACK_BLOCKS = 3_000;
const CONCURRENT_CHUNKS = 2;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

type RawEntry = { hash: string; direction: TxDirection; amountWh: number; counterparty: string; blockNumber: number };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs async tasks with bounded concurrency, preserving input order in the result array. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Retries a flaky public-RPC call a couple of times with a fixed backoff before giving up. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Reads this wallet's history straight from chain event logs -- Transfer
 * (P2P sends/receives), Minted (top-ups), Consumed (meter usage).
 * Transfer also fires on mint/burn under the hood (standard ERC20 behavior),
 * so logs touching the zero address are skipped since Minted/Consumed
 * already cover those.
 *
 * Fetches all three event types in one combined eth_getLogs call per chunk
 * (filtering only on topic0, not the indexed wallet address -- Transfer's
 * indexed params don't line up positionally with Minted/Consumed's), then
 * filters for this wallet client-side. The contract is young enough that
 * total event volume per chunk is small, so this is cheaper than 4x the
 * request count to filter server-side per event type.
 */
export async function getTransactionHistory(walletAddress: string): Promise<TxRecord[]> {
  const contract = getReadContract();
  const provider = getReadProvider();

  const transferTopic = contract.filters.Transfer().fragment.topicHash;
  const mintedTopic = contract.filters.Minted().fragment.topicHash;
  const consumedTopic = contract.filters.Consumed().fragment.topicHash;

  const latest = await provider.getBlockNumber();
  const earliest = Math.max(0, latest - MAX_LOOKBACK_BLOCKS);

  const chunkStarts: number[] = [];
  for (let from = earliest; from <= latest; from += CHUNK_SIZE) {
    chunkStarts.push(from);
  }

  const chunkLogs = await mapWithConcurrency(chunkStarts, CONCURRENT_CHUNKS, (from) =>
    withRetry(() =>
      provider.getLogs({
        address: contract.target as string,
        fromBlock: from,
        toBlock: Math.min(from + CHUNK_SIZE - 1, latest),
        topics: [[transferTopic, mintedTopic, consumedTopic]],
      })
    )
  );

  const raw: RawEntry[] = [];
  const lowerWallet = walletAddress.toLowerCase();

  for (const logs of chunkLogs) {
    for (const log of logs) {
      let parsed;
      try {
        parsed = contract.interface.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed) continue;

      if (parsed.name === "Transfer") {
        const { from, to, value } = parsed.args;
        if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) continue; // covered by Minted/Consumed
        if (from.toLowerCase() === lowerWallet) {
          raw.push({ hash: log.transactionHash, direction: "transfer-out", amountWh: Number(value), counterparty: to, blockNumber: log.blockNumber });
        } else if (to.toLowerCase() === lowerWallet) {
          raw.push({ hash: log.transactionHash, direction: "transfer-in", amountWh: Number(value), counterparty: from, blockNumber: log.blockNumber });
        }
      } else if (parsed.name === "Minted") {
        const { to, wh } = parsed.args;
        if (to.toLowerCase() === lowerWallet) {
          raw.push({ hash: log.transactionHash, direction: "mint", amountWh: Number(wh), counterparty: "Oracle (top-up)", blockNumber: log.blockNumber });
        }
      } else if (parsed.name === "Consumed") {
        const { from, wh } = parsed.args;
        if (from.toLowerCase() === lowerWallet) {
          raw.push({ hash: log.transactionHash, direction: "burn", amountWh: Number(wh), counterparty: "Meter consumption", blockNumber: log.blockNumber });
        }
      }
    }
  }

  raw.sort((a, b) => b.blockNumber - a.blockNumber);

  const blockNumbers = [...new Set(raw.map((entry) => entry.blockNumber))];
  const blocks = await mapWithConcurrency(blockNumbers, CONCURRENT_CHUNKS, (blockNumber) =>
    withRetry(() => provider.getBlock(blockNumber))
  );
  const timestampByBlock = new Map(blockNumbers.map((blockNumber, i) => [blockNumber, (blocks[i]?.timestamp ?? 0) * 1000]));

  return raw.map(({ blockNumber, ...entry }) => ({
    ...entry,
    timestamp: timestampByBlock.get(blockNumber) ?? 0,
  }));
}
