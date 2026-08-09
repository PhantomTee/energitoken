/**
 * The exact message a wallet signs to prove it owns the address being bound
 * to a Firebase Anonymous Auth uid (see firebaseSession.ts and
 * app/api/session/bind.ts, which both import this so client and server can
 * never drift out of sync on the signed string).
 */
export function buildBindMessage(uid: string, walletAddress: string): string {
  return `EnergiToken session bind\nuid:${uid}\nwallet:${walletAddress}`;
}
