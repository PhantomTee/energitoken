import { ethers } from "ethers";
import contractInfo from "../../src/config/contract.json";

/** Public RPC endpoints are occasionally unreachable (DNS hiccups, rate
 * limits) from Vercel's serverless network -- retry a few times with a short
 * backoff before giving up, rather than failing a genuinely-paid order on
 * one transient blip. */
const MAX_SEND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;
const RECEIPT_POLL_ATTEMPTS = 5;
const RECEIPT_POLL_DELAY_MS = 2000;

/**
 * Signs and sends the mint() transaction as the contract's oracle. This is
 * the one place the oracle's private key is ever loaded — server-side only,
 * never shipped to the mobile app.
 *
 * Retry safety: only the SEND step (contract.mint()) is retried with a fresh
 * transaction. If a send succeeds but tx.wait() then fails (e.g. an RPC
 * hiccup while polling for the receipt), we do NOT resend -- the previous
 * transaction is already broadcast and will consume its nonce regardless.
 * Resending here would let two live transactions both land, minting the
 * user double the tokens for one payment. Instead we poll for that same
 * transaction's receipt using its known hash.
 */
export async function mintEngy(toAddress: string, whAmount: number): Promise<string> {
  // rpc-amoy.polygon.technology (old default) is confirmed dead -- doesn't
  // even resolve via DNS anymore, not just flaky.
  const rpcUrl = process.env.AMOY_RPC_URL ?? "https://polygon-amoy-bor-rpc.publicnode.com";
  const oraclePrivateKey = process.env.ORACLE_PRIVATE_KEY;

  if (!oraclePrivateKey) {
    throw new Error("Missing ORACLE_PRIVATE_KEY env var");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const oracleWallet = new ethers.Wallet(oraclePrivateKey, provider);
  const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, oracleWallet);

  let lastSendError: unknown;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    let txHash: string;
    try {
      const tx = await contract.mint(toAddress, whAmount);
      txHash = tx.hash;
    } catch (err) {
      // Send itself failed -- nothing was broadcast, safe to retry with a
      // fresh transaction.
      lastSendError = err;
      if (attempt < MAX_SEND_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      throw lastSendError instanceof Error ? lastSendError : new Error("mintEngy send failed after retries");
    }

    // Sent successfully -- poll for the receipt using this exact tx hash.
    // Never resend past this point, regardless of how many poll attempts fail.
    for (let pollAttempt = 1; pollAttempt <= RECEIPT_POLL_ATTEMPTS; pollAttempt++) {
      try {
        const receipt = await provider.waitForTransaction(txHash, 1, RECEIPT_POLL_DELAY_MS * 2);
        if (receipt) return receipt.hash;
      } catch {
        // RPC hiccup polling for the receipt -- the transaction is still
        // out there, keep polling for it rather than giving up on it.
      }
      if (pollAttempt < RECEIPT_POLL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_DELAY_MS));
      }
    }

    // Exhausted polling for this specific transaction. It may still confirm
    // later, but we can't wait forever inside a serverless function -- throw
    // so the order lands in "mint_failed", not silently "succeed" without a
    // confirmed hash. An operator retry will find the original tx already
    // mined (via the on-chain state) rather than blindly resending.
    throw new Error(`mintEngy: transaction ${txHash} sent but receipt not confirmed after polling`);
  }

  throw lastSendError instanceof Error ? lastSendError : new Error("mintEngy failed after retries");
}
