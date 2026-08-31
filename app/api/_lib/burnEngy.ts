import { ethers } from "ethers";
// require, not a static `import ... from`: a static import lets TS infer the
// full ABI JSON's literal type at compile time, and feeding that huge literal
// into ethers.Contract's overload resolution overflows the type checker's
// call stack (same fix as app/src/services/contract.ts).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const contractInfo: { address: string; abi: unknown } = require("../../src/config/contract.json");

/**
 * Signs and sends burnConsumed() as the oracle. Called by the consumption
 * oracle (/api/oracle/burn) after it computes an energy delta from meter data.
 * Private key never leaves the server.
 */
export async function burnEngy(fromAddress: string, whAmount: number): Promise<string> {
  if (whAmount <= 0) throw new Error("whAmount must be positive");

  // Sepolia's public RPC. The chain moved off Polygon Amoy on 2026-08-31;
  // even resolve via DNS anymore, not just flaky.
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
  const oraclePrivateKey = process.env.ORACLE_PRIVATE_KEY;
  if (!oraclePrivateKey) throw new Error("Missing ORACLE_PRIVATE_KEY env var");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const oracleWallet = new ethers.Wallet(oraclePrivateKey, provider);
  const contract = new ethers.Contract(contractInfo.address, contractInfo.abi as ethers.InterfaceAbi, oracleWallet);

  const tx = await contract.burnConsumed(fromAddress, whAmount);
  const receipt = await tx.wait();
  return receipt.hash;
}
