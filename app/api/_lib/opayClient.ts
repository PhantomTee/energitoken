/**
 * Thin wrapper around OPay's Cashier API.
 * https://documentation.opaycheckout.com — Express Checkout / OPay Cashier.
 */
import { createHmac } from "crypto";

export type OPayPaymentStatus = {
  reference: string;
  orderNo: string;
  status: string; // "INITIAL" | "PENDING" | "SUCCESS" | "FAIL" | "CANCEL" | "CLOSE"
  amount: { total: number; currency: string };
  merchantId: string;
};

type QueryStatusResponse = {
  code: string;
  message: string;
  data?: OPayPaymentStatus;
};

/**
 * Queries OPay server-to-server for the authoritative payment status.
 * Must be called from the callback handler before trusting the callback body.
 *
 * Unlike Cashier creation (public-key Bearer auth), the status/query endpoint
 * requires the request body to be signed: Authorization: Bearer <hex HMAC-SHA512
 * of the exact JSON body, keyed with the merchant's private/secret key>. Node's
 * JSON.stringify doesn't escape forward slashes, matching OPay's documented
 * "JSON_UNESCAPED_SLASHES" requirement, so no extra escaping is needed --
 * but the exact string that gets signed must be the exact string sent as the
 * body (not re-stringified), or the signature won't match on OPay's side.
 */
export async function queryPaymentStatus(reference: string): Promise<OPayPaymentStatus> {
  const { secretKey, merchantId, baseUrl } = getOpaySecretConfig();

  // Field order matches OPay's own documented signing example verbatim
  // (country before reference) -- if their verification does a literal
  // byte-for-byte match rather than re-serializing, order matters.
  const bodyJson = JSON.stringify({ country: "NG", reference });
  const signature = createHmac("sha512", secretKey).update(bodyJson).digest("hex");

  const response = await fetch(`${baseUrl}/api/v1/international/cashier/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signature}`,
      MerchantId: merchantId,
    },
    body: bodyJson,
  });

  const json = (await response.json()) as QueryStatusResponse;

  if (!response.ok || json.code !== "00000" || !json.data) {
    throw new Error(`OPay status query failed: ${json.code ?? response.status} ${json.message ?? ""}`);
  }

  return json.data;
}

type CreateCashierPaymentInput = {
  reference: string;
  amountNgn: number;
  returnUrl: string;
  cancelUrl: string;
  callbackUrl: string;
  userEmail?: string;
};

type CreateCashierPaymentResponse = {
  code: string;
  message: string;
  data?: {
    reference: string;
    orderNo: string;
    cashierUrl: string;
    status: string;
  };
};

function getOpayConfig() {
  const publicKey = process.env.OPAY_PUBLIC_KEY;
  const merchantId = process.env.OPAY_MERCHANT_ID;
  const baseUrl = process.env.OPAY_BASE_URL ?? "https://testapi.opaycheckout.com";

  if (!publicKey || !merchantId) {
    throw new Error("Missing OPAY_PUBLIC_KEY or OPAY_MERCHANT_ID env vars");
  }

  return { publicKey, merchantId, baseUrl };
}

/** Separate from getOpayConfig() -- the query/status endpoint needs the
 * private/secret key (for HMAC signing), not the public key used to create
 * a Cashier order. */
function getOpaySecretConfig() {
  // .trim() defends against a trailing newline/space picked up when the key
  // was copy-pasted into the Vercel CLI/dashboard -- that would silently
  // corrupt every HMAC signature with no other symptom than "auth failed".
  const secretKey = process.env.OPAY_SECRET_KEY?.trim();
  const merchantId = process.env.OPAY_MERCHANT_ID?.trim();
  const baseUrl = process.env.OPAY_BASE_URL ?? "https://testapi.opaycheckout.com";

  if (!secretKey || !merchantId) {
    throw new Error("Missing OPAY_SECRET_KEY or OPAY_MERCHANT_ID env vars");
  }

  return { secretKey, merchantId, baseUrl };
}

export async function createCashierPayment(
  input: CreateCashierPaymentInput
): Promise<CreateCashierPaymentResponse> {
  const { publicKey, merchantId, baseUrl } = getOpayConfig();

  const response = await fetch(`${baseUrl}/api/v1/international/cashier/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${publicKey}`,
      MerchantId: merchantId,
    },
    body: JSON.stringify({
      country: "NG",
      reference: input.reference,
      amount: {
        // OPay expects the amount in kobo (NGN's smallest unit): 1 NGN = 100 kobo.
        total: Math.round(input.amountNgn * 100),
        currency: "NGN",
      },
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      callbackUrl: input.callbackUrl,
      customerVisitSource: "BROWSER",
      // Force the browser-based payment flow instead of deep-linking into
      // the native OPay app -- on a device without the app installed, the
      // checkout page can get stuck waiting on that deep link (observed as
      // "Continue to OPay" never redirecting, alongside a failed fraud-check
      // websocket) instead of falling back to in-page payment methods.
      evokeOpay: false,
      product: {
        name: "EnergiToken top-up",
        description: "Prepaid household electricity credit (ENGY)",
      },
      ...(input.userEmail ? { userInfo: { userEmail: input.userEmail } } : {}),
    }),
  });

  const json = (await response.json()) as CreateCashierPaymentResponse;

  if (!response.ok || json.code !== "00000") {
    throw new Error(`OPay cashier create failed: ${json.code ?? response.status} ${json.message ?? ""}`);
  }

  return json;
}
