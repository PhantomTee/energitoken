import { ethers } from "ethers";
// require, not a static `import ... from`: a static import lets TS infer the
// full ABI JSON's literal type at compile time, and feeding that huge literal
// into ethers.Contract's overload resolution overflows the type checker's
// call stack (same fix as app/src/services/contract.ts).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const contractInfo: { address: string; abi: unknown } = require("../../src/config/contract.json");

/**
 * Signs and sends setPendingBurn() as the oracle. Called every few minutes
 * by /api/oracle/set-pending with the household's total consumption since
 * the last burnConsumed, so transfer() can enforce a spendable balance in
 * between burn batches. Overwrites rather than accumulates -- safe to call
 * repeatedly with a freshly-computed total.
 */
export async function setPendingBurnEngy(walletAddress: string, whAmount: number): Promise<string> {
  if (whAmount < 0) throw new Error("whAmount must not be negative");

  const rpcUrl = process.env.AMOY_RPC_URL ?? "https://polygon-amoy-bor-rpc.publicnode.com";
  const oraclePrivateKey = process.env.ORACLE_PRIVATE_KEY;
  if (!oraclePrivateKey) throw new Error("Missing ORACLE_PRIVATE_KEY env var");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const oracleWallet = new ethers.Wallet(oraclePrivateKey, provider);
  const contract = new ethers.Contract(contractInfo.address, contractInfo.abi as ethers.InterfaceAbi, oracleWallet);

  const tx = await contract.setPendingBurn(walletAddress, whAmount);
  const receipt = await tx.wait();
  return receipt.hash;
}
