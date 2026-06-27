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
 * Reads this wallet's full history straight from chain event logs --
 * Transfer (for P2P sends/receives), Minted (OPay top-ups), Consumed (meter
 * usage). Transfer also fires on mint/burn under the hood (standard ERC20
 * behavior), so logs touching the zero address are skipped here since
 * Minted/Consumed already cover those.
 *
 * Queries from block 0: fine for a contract this young, but a long-lived
 * deployment would need to paginate by block range, since public RPC
 * endpoints often cap how many blocks a single getLogs call can span.
 */
export async function getTransactionHistory(walletAddress: string): Promise<TxRecord[]> {
  const contract = getReadContract();
  const provider = getReadProvider();

  const [sent, received, minted, consumed] = await Promise.all([
    contract.queryFilter(contract.filters.Transfer(walletAddress, null), 0, "latest"),
    contract.queryFilter(contract.filters.Transfer(null, walletAddress), 0, "latest"),
    contract.queryFilter(contract.filters.Minted(walletAddress), 0, "latest"),
    contract.queryFilter(contract.filters.Consumed(walletAddress), 0, "latest"),
  ]);

  type RawEntry = { hash: string; direction: TxDirection; amountWh: number; counterparty: string; blockNumber: number };
  const raw: RawEntry[] = [];

  for (const event of sent) {
    if (!(event instanceof ethers.EventLog)) continue;
    const { from, to, value } = event.args;
    if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) continue; // covered by Minted/Consumed
    raw.push({ hash: event.transactionHash, direction: "transfer-out", amountWh: Number(value), counterparty: to, blockNumber: event.blockNumber });
  }
  for (const event of received) {
    if (!(event instanceof ethers.EventLog)) continue;
    const { from, to, value } = event.args;
    if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) continue;
    raw.push({ hash: event.transactionHash, direction: "transfer-in", amountWh: Number(value), counterparty: from, blockNumber: event.blockNumber });
  }
  for (const event of minted) {
    if (!(event instanceof ethers.EventLog)) continue;
    raw.push({ hash: event.transactionHash, direction: "mint", amountWh: Number(event.args.wh), counterparty: "Oracle (OPay top-up)", blockNumber: event.blockNumber });
  }
  for (const event of consumed) {
    if (!(event instanceof ethers.EventLog)) continue;
    raw.push({ hash: event.transactionHash, direction: "burn", amountWh: Number(event.args.wh), counterparty: "Meter consumption", blockNumber: event.blockNumber });
  }

  raw.sort((a, b) => b.blockNumber - a.blockNumber);

  const blockNumbers = [...new Set(raw.map((entry) => entry.blockNumber))];
  const blocks = await Promise.all(blockNumbers.map((blockNumber) => provider.getBlock(blockNumber)));
  const timestampByBlock = new Map(blocks.map((block, i) => [blockNumbers[i], (block?.timestamp ?? 0) * 1000]));

  return raw.map(({ blockNumber, ...entry }) => ({
    ...entry,
    timestamp: timestampByBlock.get(blockNumber) ?? 0,
  }));
}
