/**
 * Thin wrapper around OPay's Cashier API.
 * https://documentation.opaycheckout.com — Express Checkout / OPay Cashier.
 */

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
 */
export async function queryPaymentStatus(reference: string): Promise<OPayPaymentStatus> {
  const { publicKey, merchantId, baseUrl } = getOpayConfig();

  const response = await fetch(`${baseUrl}/api/v1/international/cashier/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${publicKey}`,
      MerchantId: merchantId,
    },
    body: JSON.stringify({ reference }),
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
