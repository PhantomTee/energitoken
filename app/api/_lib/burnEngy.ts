import { ethers } from "ethers";
import contractInfo from "../../src/config/contract.json";

/**
 * Signs and sends burnConsumed() as the oracle. Called by the consumption
 * oracle (/api/oracle/burn) after it computes an energy delta from meter data.
 * Private key never leaves the server.
 */
export async function burnEngy(fromAddress: string, whAmount: number): Promise<string> {
  if (whAmount <= 0) throw new Error("whAmount must be positive");

  // rpc-amoy.polygon.technology (old default) is confirmed dead -- doesn't
  // even resolve via DNS anymore, not just flaky.
  const rpcUrl = process.env.AMOY_RPC_URL ?? "https://polygon-amoy-bor-rpc.publicnode.com";
  const oraclePrivateKey = process.env.ORACLE_PRIVATE_KEY;
  if (!oraclePrivateKey) throw new Error("Missing ORACLE_PRIVATE_KEY env var");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const oracleWallet = new ethers.Wallet(oraclePrivateKey, provider);
  const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, oracleWallet);

  const tx = await contract.burnConsumed(fromAddress, whAmount);
  const receipt = await tx.wait();
  return receipt.hash;
}
