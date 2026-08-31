import { ethers } from "ethers";
// require, not a static `import ... from`: a static import lets TS infer the
// full ABI JSON's literal type at compile time, and feeding that huge literal
// into ethers.Contract's overload resolution overflows the type checker's
// call stack (same fix as app/src/services/contract.ts).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const contractInfo: { address: string; abi: unknown } = require("../../src/config/contract.json");

let readProvider: ethers.JsonRpcProvider | null = null;

/** Server-side read-only provider, same RPC env var and fallback as the
 * write-side oracle helpers (burnEngy.ts, setPendingBurn.ts) -- kept
 * separate from app/src/services/contract.ts's client-side provider, which
 * is built for the Expo bundler (EXPO_PUBLIC_ env prefix, batching disabled
 * for the public RPC) and isn't meant to run in this runtime. */
function getServerReadProvider(): ethers.JsonRpcProvider {
  if (!readProvider) {
    const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
    readProvider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return readProvider;
}

function getServerReadContract(): ethers.Contract {
  return new ethers.Contract(contractInfo.address, contractInfo.abi as ethers.InterfaceAbi, getServerReadProvider());
}

/** ENGY balance in whole watt-hours (the token has 0 decimals). */
export async function getEngyBalanceServer(walletAddress: string): Promise<bigint> {
  return getServerReadContract().balanceOf(walletAddress);
}

/** Spendable balance (on-chain balance minus unsettled consumption) -- same
 * figure app/src/services/contract.ts's getSpendableBalance mirrors for the
 * client, re-derived server-side from the chain itself rather than trusted
 * from any webhook payload. */
export async function getSpendableBalanceServer(walletAddress: string): Promise<bigint> {
  return getServerReadContract().spendableBalanceOf(walletAddress);
}
