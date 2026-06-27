import { ethers } from "ethers";
import contractInfo from "../../src/config/contract.json";

/**
 * Signs and sends the mint() transaction as the contract's oracle. This is
 * the one place the oracle's private key is ever loaded — server-side only,
 * never shipped to the mobile app.
 */
export async function mintEngy(toAddress: string, whAmount: number): Promise<string> {
  const rpcUrl = process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology";
  const oraclePrivateKey = process.env.ORACLE_PRIVATE_KEY;

  if (!oraclePrivateKey) {
    throw new Error("Missing ORACLE_PRIVATE_KEY env var");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const oracleWallet = new ethers.Wallet(oraclePrivateKey, provider);
  const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, oracleWallet);

  const tx = await contract.mint(toAddress, whAmount);
  const receipt = await tx.wait();
  return receipt.hash;
}
