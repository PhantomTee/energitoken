/**
 * Privy's SDK throws its raw fetch/JSON error verbatim when its API returns
 * something unparseable -- an HTML captive-Wi-Fi portal page, a CDN error
 * page, or a transient 5xx with no JSON body. Users saw this literally as
 * "JSON Parse error: Unexpected character: <", which is meaningless to them.
 * Translate the recognisable network-failure shapes into something actionable;
 * anything else still shows Privy's message verbatim (still more useful than
 * a generic "something went wrong" for genuine account/validation errors).
 */
export function friendlyAuthError(rawMessage: string): string {
  const msg = rawMessage.toLowerCase();
  if (msg.includes("timeout") || msg.includes("aborted")) {
    return "Connection timed out. Please check your network and try again.";
  }
  if (msg.includes("json parse") || msg.includes("unexpected character") || msg.includes("unexpected token")) {
    return "Couldn't reach the login server. Check your internet connection (or Wi-Fi sign-in page) and try again.";
  }
  // Deliberately specific -- a bare "network" substring also matches Privy
  // errors like "unsupported network" or "network mismatch" (chain/config
  // problems, nothing to do with connectivity), which this was silently
  // mislabeling as a connection issue.
  if (msg.includes("network error") || msg.includes("network request failed") || msg.includes("no internet")) {
    return "No network connection. Check your internet and try again.";
  }
  return rawMessage;
}
