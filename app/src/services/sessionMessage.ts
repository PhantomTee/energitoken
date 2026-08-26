/**
 * The exact message a wallet signs to prove ownership when requesting an app
 * session token (see firebaseSession.ts and app/api/session/create.ts, which
 * both import this so client and server can never drift out of sync on the
 * signed string). Deliberately no server-issued nonce: a replayed signature
 * only ever proves the same true fact again (this wallet controls itself),
 * it can't be used to mint a session for a different wallet.
 */
export function buildSessionMessage(walletAddress: string): string {
  return `EnergiToken session login\nwallet:${walletAddress}`;
}
