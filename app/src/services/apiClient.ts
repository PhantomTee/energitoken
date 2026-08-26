import { Platform } from "react-native";
import { ethers } from "ethers";
import { getSessionToken } from "./firebaseSession";

const BACKEND_URL = Platform.OS === "web" ? "" : process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app";

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
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((json as { error?: string }).error ?? `Request failed (${response.status})`);
  }
  return json as T;
}
