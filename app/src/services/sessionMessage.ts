/**
 * The exact message a wallet signs to prove ownership when requesting an app
 * session token (see firebaseSession.ts and app/api/session/create.ts, which
 * both import this so client and server can never drift out of sync on the
 * signed string). Includes a server-issued one-time nonce (fetched via GET
 * /api/session/create before signing) -- without one, a captured signature
 * proves wallet ownership forever, with no expiry and no way to invalidate
 * it. The nonce ties each signature to a single, short-lived, single-use
 * server challenge instead.
 */
export function buildSessionMessage(walletAddress: string, nonce: string): string {
  return `EnergiToken session login\nwallet:${walletAddress}\nnonce:${nonce}`;
}
