import { Platform } from "react-native";
import { ethers } from "ethers";
import { getSessionToken } from "./firebaseSession";

const BACKEND_URL = Platform.OS === "web" ? "" : process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app";

/** Every app->server call used to have no bounded timeout at all -- a
 * hung connection (dead WiFi, a stalled Vercel cold start) left the caller
 * awaiting a promise that would only ever resolve or reject on its own
 * schedule, with no way for the UI to give up and show an error. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Shared fetch wrapper for every app->server call. Attaches this wallet's
 * session token (see firebaseSession.ts) as a Bearer credential -- the
 * server derives the caller's wallet from it and does the actual Firebase
 * work via the Admin SDK. Throws a message pulled from the response body's
 * `error` field on a non-2xx response.
 */
export async function apiRequest<T>(
  path: string,
  walletAddress: string,
  getSigner: () => Promise<ethers.Signer>,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const token = await getSessionToken(walletAddress, getSigner);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((json as { error?: string }).error ?? `Request failed (${response.status})`);
  }
  return json as T;
}
