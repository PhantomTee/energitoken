import { ethers } from "ethers";
import contractInfo from "../../src/config/contract.json";

/** Public RPC endpoints are occasionally unreachable (DNS hiccups, rate
 * limits) from Vercel's serverless network -- retry a few times with a short
 * backoff before giving up, rather than failing a genuinely-paid order on
 * one transient blip. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

/**
 * Signs and sends the mint() transaction as the contract's oracle. This is
 * the one place the oracle's private key is ever loaded — server-side only,
 * never shipped to the mobile app.
 */
export async function mintEngy(toAddress: string, whAmount: number): Promise<string> {
  // rpc-amoy.polygon.technology (old default) is confirmed dead -- doesn't
  // even resolve via DNS anymore, not just flaky.
  const rpcUrl = process.env.AMOY_RPC_URL ?? "https://polygon-amoy-bor-rpc.publicnode.com";
  const oraclePrivateKey = process.env.ORACLE_PRIVATE_KEY;

  if (!oraclePrivateKey) {
    throw new Error("Missing ORACLE_PRIVATE_KEY env var");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const oracleWallet = new ethers.Wallet(oraclePrivateKey, provider);
      const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, oracleWallet);

      const tx = await contract.mint(toAddress, whAmount);
      const receipt = await tx.wait();
      return receipt.hash;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("mintEngy failed after retries");
}
