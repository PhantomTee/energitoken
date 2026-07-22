/**
 * Thin wrapper around Flutterwave's v3 Standard (hosted) checkout API.
 * https://developer.flutterwave.com/v3.0.0/docs/flutterwave-standard-1
 *
 * v3 (not the newer v4) deliberately: a single secret-key Bearer auth for
 * every call, one API call to get a hosted payment link, and a simple
 * static-secret webhook header -- v4 requires OAuth2 token exchange plus
 * separate customer/payment-method/charge objects before you even get a
 * redirect link, which is unnecessary complexity for this use case.
 */
import { createHash, timingSafeEqual } from "crypto";

const FLW_BASE_URL = "https://api.flutterwave.com/v3";

export type FlutterwaveTransactionStatus = {
  id: number;
  tx_ref: string;
  flw_ref: string;
  amount: number;
  currency: string;
  charged_amount: number;
  status: string; // "successful" | "failed" | "pending" | ...
};

type ApiResponse<T> = {
  status: string; // "success" | "error"
  message: string;
  data?: T;
};

function getSecretKey(): string {
  // .trim() defends against copy-paste whitespace -- the same silent-corruption
  // failure mode we hit with OPay's secret key.
  const key = process.env.FLW_SECRET_KEY?.trim();
  if (!key) throw new Error("Missing FLW_SECRET_KEY env var");
  return key;
}

/**
 * Creates a Standard (hosted) checkout payment and returns the link to
 * redirect the customer to. Auth is the SECRET key here (unlike OPay, which
 * split public/secret across create vs. verify) -- v3 uses one key for
 * everything server-side.
 */
export async function createPayment(input: {
  txRef: string;
  amountNgn: number;
  redirectUrl: string;
  customerEmail?: string;
}): Promise<{ link: string }> {
  const response = await fetch(`${FLW_BASE_URL}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getSecretKey()}`,
    },
    body: JSON.stringify({
      tx_ref: input.txRef,
      amount: input.amountNgn,
      currency: "NGN",
      redirect_url: input.redirectUrl,
      customer: { email: input.customerEmail ?? "topup@energitoken.app" },
      customizations: { title: "EnergiToken top-up" },
    }),
  });

  const json = (await response.json()) as ApiResponse<{ link: string }>;

  if (!response.ok || json.status !== "success" || !json.data?.link) {
    throw new Error(`Flutterwave create payment failed: ${json.message ?? response.status}`);
  }

  return { link: json.data.link };
}

/**
 * Verifies a transaction by our own tx_ref -- used for polling before we
 * have Flutterwave's numeric transaction id (e.g. the app checking payment
 * status right after the user returns from checkout, ahead of any webhook).
 */
export async function verifyTransactionByReference(txRef: string): Promise<FlutterwaveTransactionStatus> {
  const response = await fetch(
    `${FLW_BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
    { headers: { Authorization: `Bearer ${getSecretKey()}` } }
  );

  const json = (await response.json()) as ApiResponse<FlutterwaveTransactionStatus>;

  if (!response.ok || json.status !== "success" || !json.data) {
    throw new Error(`Flutterwave verify_by_reference failed: ${json.message ?? response.status}`);
  }

  return json.data;
}

/**
 * Verifies a transaction by Flutterwave's numeric id -- this is the
 * authoritative check the webhook handler uses before minting; the id comes
 * from the webhook payload's data.id, never trusted on its own.
 */
export async function verifyTransactionById(id: number): Promise<FlutterwaveTransactionStatus> {
  const response = await fetch(`${FLW_BASE_URL}/transactions/${id}/verify`, {
    headers: { Authorization: `Bearer ${getSecretKey()}` },
  });

  const json = (await response.json()) as ApiResponse<FlutterwaveTransactionStatus>;

  if (!response.ok || json.status !== "success" || !json.data) {
    throw new Error(`Flutterwave verify failed: ${json.message ?? response.status}`);
  }

  return json.data;
}

/**
 * Flutterwave's webhook auth model: a static secret hash you choose and
 * configure once in the Dashboard (Settings -> Webhooks), sent back on every
 * webhook call in the `verif-hash` header. Not a computed signature -- a
 * direct, timing-safe string compare against the same value stored here.
 */
export function verifyWebhookSignature(receivedHash: string | undefined): boolean {
  const expected = process.env.FLW_SECRET_HASH?.trim();
  if (!expected || !receivedHash) return false;

  // Compare against a fixed-length hash of both strings first, so a length
  // mismatch doesn't short-circuit before any constant-time work happens --
  // an early `return false` on `.length` differences is itself a timing
  // side-channel (reveals the secret's length via response time). Padding
  // both to the same fixed size (via a hash) means the comparison loop
  // always runs the same amount of work regardless of input length.
  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash_ = createHash("sha256").update(receivedHash).digest();

  const lengthsMatch = expected.length === receivedHash.length;
  const hashesMatch = timingSafeEqual(expectedHash, receivedHash_);

  return lengthsMatch && hashesMatch;
}
