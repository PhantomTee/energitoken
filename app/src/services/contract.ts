import { ethers } from "ethers";

/**
 * Loaded via require, not `import ... from ".../contract.json"` -- a static
 * ES import lets TS infer the full ABI JSON's literal type at compile time,
 * and feeding that huge literal into ethers.Contract's overload resolution
 * overflows the type checker's call stack (a known issue with large inline
 * ABI JSON). `require` keeps the value untyped (`any`) instead.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const contractInfo: { address: string; abi: unknown } = require("../config/contract.json");

export const CONTRACT_ADDRESS: string = contractInfo.address;
export const CONTRACT_ABI = contractInfo.abi as ethers.InterfaceAbi;

// Ethereum Sepolia replaced Polygon Amoy on 2026-08-31. Amoy's faucets had
// become effectively unobtainable without an existing mainnet balance, and
// the oracle wallet was down to roughly nine transactions of gas with no way
// to refill it. Sepolia's faucets are reachable, and its gas price at the
// time of the switch was 1.0 gwei against Amoy's 37.5, so a single faucet
// drip goes about thirty times further.
const SEPOLIA_RPC_URL = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
export const CHAIN_ID = 11155111n;
export const CHAIN_NAME = "Sepolia";
/** The chain's own gas token, for wording in the errors below. */
export const GAS_TOKEN = "SepoliaETH";

let readProvider: ethers.JsonRpcProvider | null = null;

/**
 * Read-only provider against the public Sepolia RPC -- no wallet/signer needed.
 * batchMaxCount: 1 disables ethers' default JSON-RPC batching: the public
 * public endpoint doesn't reliably support batched requests, and sending the
 * 4 concurrent getLogs calls in getTransactionHistory as one batch produces
 * a "could not coalesce error" (code -32000) instead of real results.
 */
export function getReadProvider(): ethers.JsonRpcProvider {
  if (!readProvider) {
    readProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL, undefined, { batchMaxCount: 1 });
  }
  return readProvider;
}

export function getReadContract(): ethers.Contract {
  return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, getReadProvider());
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BALANCE_READ_MAX_RETRIES = 3;
const BALANCE_READ_BASE_DELAY_MS = 500;

/**
 * The public RPC rate-limits per IP under real load (see
 * contractEvents.ts's MAX_LOOKBACK_BLOCKS comment) -- a balance read hitting
 * that 429 shouldn't just surface as a stuck "···" on Dashboard. Back off
 * exponentially and retry a few times before giving up, same idea as
 * contractEvents.ts's withRetry but exponential rather than fixed-step,
 * since a 429 specifically wants growing gaps between attempts.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= BALANCE_READ_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < BALANCE_READ_MAX_RETRIES) {
        await sleep(BALANCE_READ_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
  throw lastError;
}

/** ENGY balance in whole watt-hours (the token has 0 decimals). */
export async function getEngyBalance(walletAddress: string): Promise<bigint> {
  const contract = getReadContract();
  return withRetry(() => contract.balanceOf(walletAddress));
}

/**
 * What this wallet can actually transfer right now: on-chain balance minus
 * energy already consumed but not yet burned (settled) on-chain. The
 * contract enforces this itself in transfer() -- see EnergiToken.sol's
 * _update override -- this is just the read-only mirror of that same figure
 * for the UI to show and pre-validate against.
 */
export async function getSpendableBalance(walletAddress: string): Promise<bigint> {
  const contract = getReadContract();
  return withRetry(() => contract.spendableBalanceOf(walletAddress));
}

/**
 * Sends transfer() via the signer's underlying provider directly, instead
 * of through ethers' normal Contract/Signer path. That normal path
 * pre-estimates gas and includes a real "gas" value in the eth_sendTransaction
 * request, but Privy's embedded-wallet provider doesn't honor that field --
 * it signs the raw transaction with gasLimit 0 regardless, which the network
 * then rejects with "intrinsic gas too low: gas 0". Privy's own docs say it
 * auto-populates gas/fee/nonce values for whatever's left unset in the
 * request, so the fix is to omit gas entirely and let Privy fill it in,
 * rather than supplying a value it silently drops.
 */
export async function sendTransferTx(
  signer: ethers.Signer,
  to: string,
  amountWh: bigint
): Promise<{ hash: string; wait: () => Promise<ethers.TransactionReceipt | null> }> {
  const provider = signer.provider;
  if (!provider) throw new Error("No network connection available from your wallet.");

  const from = await signer.getAddress();
  const iface = new ethers.Interface(CONTRACT_ABI);
  const data = iface.encodeFunctionData("transfer", [to, amountWh]);

  const hash: string = await (provider as ethers.BrowserProvider).send("eth_sendTransaction", [
    { from, to: CONTRACT_ADDRESS, data },
  ]);

  return { hash, wait: () => provider.waitForTransaction(hash) };
}

/**
 * Network + gas check only, used to render the Transfer screen's live
 * pre-flight checklist (separate from the amount/balance checks, which the
 * form already validates from local state). Never throws -- a failed read
 * just means the checklist shows that item as not-yet-confirmed.
 */
export async function checkNetworkAndGas(
  signer: ethers.Signer
): Promise<{ networkOk: boolean; gasOk: boolean }> {
  try {
    const provider = signer.provider;
    if (!provider) return { networkOk: false, gasOk: false };

    const network = await provider.getNetwork();
    const networkOk = network.chainId === CHAIN_ID;

    const address = await signer.getAddress();
    const gasBalance = await provider.getBalance(address);
    const gasOk = gasBalance > 0n;

    return { networkOk, gasOk };
  } catch {
    return { networkOk: false, gasOk: false };
  }
}

/**
 * Checked right before calling transfer() -- not just at form-validation time --
 * since the wallet's actual network/gas state can change between when the
 * form was filled and when the user taps confirm. Returns a specific error
 * string for whichever check fails, or null if it's safe to proceed.
 */
export async function runTransferPreflight(
  signer: ethers.Signer,
  amountWh: number,
  spendableBalanceWh: bigint
): Promise<string | null> {
  if (amountWh <= 0) return "Enter an amount greater than 0.";
  if (BigInt(Math.floor(amountWh)) > spendableBalanceWh) {
    return "Amount exceeds your spendable balance (energy already used but not yet settled on-chain can't be sent).";
  }

  const provider = signer.provider;
  if (!provider) return "No network connection available from your wallet.";

  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    return `Your wallet is on the wrong network (chain ${network.chainId}). Switch to ${CHAIN_NAME}.`;
  }

  const address = await signer.getAddress();
  const gasBalance = await provider.getBalance(address);
  if (gasBalance === 0n) {
    return `Your wallet has no ${GAS_TOKEN} for gas. Fund it from a ${CHAIN_NAME} faucet first.`;
  }

  return null;
}
