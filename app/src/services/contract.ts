import { ethers } from "ethers";

/**
 * Loaded via require, not `import ... from ".../contract.json"` — a static
 * ES import lets TS infer the full ABI JSON's literal type at compile time,
 * and feeding that huge literal into ethers.Contract's overload resolution
 * overflows the type checker's call stack (a known issue with large inline
 * ABI JSON). `require` keeps the value untyped (`any`) instead.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const contractInfo: { address: string; abi: unknown } = require("../config/contract.json");

export const CONTRACT_ADDRESS: string = contractInfo.address;
export const CONTRACT_ABI = contractInfo.abi as ethers.InterfaceAbi;

// rpc-amoy.polygon.technology (the old default) stopped resolving entirely --
// confirmed dead via direct DNS lookup, not just flaky. publicnode.com is a
// reliable, no-API-key-required public RPC aggregator.
const AMOY_RPC_URL = process.env.EXPO_PUBLIC_AMOY_RPC_URL ?? "https://polygon-amoy-bor-rpc.publicnode.com";
export const AMOY_CHAIN_ID = 80002n;

let readProvider: ethers.JsonRpcProvider | null = null;

/**
 * Read-only provider against the public Amoy RPC — no wallet/signer needed.
 * batchMaxCount: 1 disables ethers' default JSON-RPC batching: the public
 * Amoy endpoint doesn't reliably support batched requests, and sending the
 * 4 concurrent getLogs calls in getTransactionHistory as one batch produces
 * a "could not coalesce error" (code -32000) instead of real results.
 */
export function getReadProvider(): ethers.JsonRpcProvider {
  if (!readProvider) {
    readProvider = new ethers.JsonRpcProvider(AMOY_RPC_URL, undefined, { batchMaxCount: 1 });
  }
  return readProvider;
}

export function getReadContract(): ethers.Contract {
  return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, getReadProvider());
}

/** ENGY balance in whole watt-hours (the token has 0 decimals). */
export async function getEngyBalance(walletAddress: string): Promise<bigint> {
  const contract = getReadContract();
  return contract.balanceOf(walletAddress);
}

/** A contract instance bound to a signer, for sending transfer() through the user's wallet. */
export function getWritableContract(signer: ethers.Signer): ethers.Contract {
  return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
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
    const networkOk = network.chainId === AMOY_CHAIN_ID;

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
  engyBalanceWh: bigint
): Promise<string | null> {
  if (amountWh <= 0) return "Enter an amount greater than 0.";
  if (BigInt(Math.floor(amountWh)) > engyBalanceWh) return "Amount exceeds your available ENGY balance.";

  const provider = signer.provider;
  if (!provider) return "No network connection available from your wallet.";

  const network = await provider.getNetwork();
  if (network.chainId !== AMOY_CHAIN_ID) {
    return `Your wallet is on the wrong network (chain ${network.chainId}). Switch to Polygon Amoy.`;
  }

  const address = await signer.getAddress();
  const gasBalance = await provider.getBalance(address);
  if (gasBalance === 0n) {
    return "Your wallet has no POL for gas. Fund it from the Polygon Amoy faucet first.";
  }

  return null;
}
