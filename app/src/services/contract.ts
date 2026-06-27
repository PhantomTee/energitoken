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

const AMOY_RPC_URL = process.env.EXPO_PUBLIC_AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology";

let readProvider: ethers.JsonRpcProvider | null = null;

/** Read-only provider against the public Amoy RPC — no wallet/signer needed. */
function getReadProvider(): ethers.JsonRpcProvider {
  if (!readProvider) {
    readProvider = new ethers.JsonRpcProvider(AMOY_RPC_URL);
  }
  return readProvider;
}

function getReadContract(): ethers.Contract {
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
