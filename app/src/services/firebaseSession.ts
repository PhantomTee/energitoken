import { Platform } from "react-native";
import { ethers } from "ethers";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildSessionMessage } from "./sessionMessage";

const BACKEND_URL = Platform.OS === "web" ? "" : process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app";
const TOKEN_STORAGE_KEY = "energitoken_session_token_v1";

/**
 * This app used to sign in to Firebase Anonymous Auth on every screen mount
 * (see git history) and use that ID token as its credential for every
 * Firebase read/write. That required the client to call Firebase's own
 * sign-in endpoint (identitytoolkit.googleapis.com), which turned out to be
 * blocked on some real user networks (school/campus WiFi, some ISPs) --
 * breaking login, live meter data, notifications, and the meter's
 * balance-gated relays all at once.
 *
 * Now the app never talks to Firebase directly. It signs a message proving
 * wallet ownership, trades that for OUR OWN session token via
 * /api/session/create, and presents that token as a Bearer credential to
 * every other /api endpoint -- which do the actual Firebase reads/writes
 * server-side via the Admin SDK (see app/api/_lib/appSession.ts). The token
 * is cached locally so this only has to happen once per ~30 days, not on
 * every screen mount.
 */
type StoredSession = { walletAddress: string; token: string; expiresAt: number };

let cached: StoredSession | null = null;

async function readStoredSession(): Promise<StoredSession | null> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    cached = parsed;
    return parsed;
  } catch {
    return null;
  }
}

async function writeStoredSession(session: StoredSession): Promise<void> {
  cached = session;
  await AsyncStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(session));
}

/**
 * Neither ethers' Signer nor Privy's getProvider() takes an AbortSignal, so
 * a hang (not just a throw) is raced against a timer instead.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/**
 * On web, getSigner() reads from Privy's useWallets(), which can lag a beat
 * behind `user` becoming ready right after login/cold-start. A few short
 * retries covers that startup race without resorting to an arbitrary fixed
 * delay.
 */
async function getSignerWithRetry(getSigner: () => Promise<ethers.Signer>): Promise<ethers.Signer> {
  const attempts = 5;
  const delayMs = 400;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(getSigner(), 8000, "Wallet signer timed out.");
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Wallet signer not available");
}

const SIGN_TIMEOUT_MS = 20000;
const CREATE_FETCH_TIMEOUT_MS = 15000;

async function createSession(walletAddress: string, getSigner: () => Promise<ethers.Signer>): Promise<StoredSession> {
  const signer = await getSignerWithRetry(getSigner);
  const message = buildSessionMessage(walletAddress);
  const signature = await withTimeout(
    signer.signMessage(message),
    SIGN_TIMEOUT_MS,
    "Signing timed out. Please try again."
  );

  const controller = new AbortController();
  const fetchTimer = setTimeout(() => controller.abort(), CREATE_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}/api/session/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress, signature }),
      signal: controller.signal,
    });
  } catch (err) {
    throw err instanceof Error && err.name === "AbortError"
      ? new Error("Couldn't reach the server. Check your connection and try again.")
      : err;
  } finally {
    clearTimeout(fetchTimer);
  }

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((json as { error?: string }).error ?? `Failed to create session (${response.status})`);
  }

  const { token, expiresAt } = json as { token: string; expiresAt: number };
  const session: StoredSession = { walletAddress, token, expiresAt };
  await writeStoredSession(session);
  return session;
}

const EXPIRY_SAFETY_MARGIN_MS = 60 * 60 * 1000; // renew an hour early, not right at the deadline

/**
 * Returns a valid Bearer token for this wallet, reusing a cached one if it's
 * not close to expiring, otherwise minting a fresh one (which requires a
 * wallet signature). Safe to call on every screen mount.
 */
export async function getSessionToken(
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>
): Promise<string> {
  const stored = await readStoredSession();
  if (
    stored &&
    stored.walletAddress.toLowerCase() === walletAddress.toLowerCase() &&
    stored.expiresAt - Date.now() > EXPIRY_SAFETY_MARGIN_MS
  ) {
    return stored.token;
  }

  const session = await createSession(walletAddress, getSigner);
  return session.token;
}

/** Call on Privy logout so the next user doesn't inherit this wallet's cached session. */
export async function clearSessionToken(): Promise<void> {
  cached = null;
  await AsyncStorage.removeItem(TOKEN_STORAGE_KEY).catch(() => {});
}
