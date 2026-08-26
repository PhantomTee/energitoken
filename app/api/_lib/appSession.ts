import crypto from "crypto";

/**
 * Our own signed session token, replacing Firebase Anonymous Auth ID tokens
 * as the app's client-to-server credential. Firebase Auth's sign-in call
 * (identitytoolkit.googleapis.com) turned out to be blocked on some real
 * user networks (school/campus WiFi, some ISPs), which broke login and
 * every Firebase read/write downstream of it. This token is minted by our
 * own server (app/api/session/create.ts) after verifying a wallet
 * signature, so the client never has to reach Firebase's auth endpoint at
 * all -- only our own already-reachable API and Firebase's Realtime
 * Database endpoint (a different, unaffected host), both accessed via the
 * Admin SDK server-side from here on.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 of that
 * string) -- same manual-HMAC pattern as meterHmac.ts, no JWT library
 * dependency needed for a single-purpose token like this.
 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret(): string {
  const s = process.env.SESSION_TOKEN_SECRET;
  if (!s) throw new Error("Missing SESSION_TOKEN_SECRET env var");
  return s;
}

function sign(payloadB64: string): string {
  return crypto.createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

export function createSessionToken(walletAddress: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payloadB64 = Buffer.from(JSON.stringify({ wallet: walletAddress, exp: expiresAt })).toString("base64url");
  return { token: `${payloadB64}.${sign(payloadB64)}`, expiresAt };
}

export function verifySessionToken(token: string): string {
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) throw new Error("Malformed session token");

  const expectedSig = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid session token");
  }

  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as {
    wallet: string;
    exp: number;
  };
  if (Date.now() > payload.exp) throw new Error("Session expired");
  return payload.wallet;
}

/** Extracts and verifies the wallet from an `Authorization: Bearer <token>` header. */
export function walletFromBearer(authorizationHeader: string | undefined): string {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : null;
  if (!token) throw new Error("Missing Authorization: Bearer <token> header");
  return verifySessionToken(token);
}
