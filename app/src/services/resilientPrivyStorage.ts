import { SecureStorageAdapter } from "@privy-io/expo";

/**
 * Wraps Privy's own SecureStorageAdapter to recover from corrupted stored
 * session data instead of throwing.
 *
 * Root cause this addresses: a device stuck showing the splash screen until
 * the user switches apps and back, with the login screen's raw-error debug
 * line reading "JSON Parse error: Unexpected character". Our own codebase
 * has zero JSON.parse calls (verified by search), so this is happening
 * inside Privy's SDK while restoring a persisted session -- almost
 * certainly because the OS (ColorOS/Oplus, confirmed via earlier logcat,
 * aggressively freezes/kills backgrounded apps) killed a previous session
 * mid-write, leaving a truncated/corrupted JSON string in SecureStore.
 * Every subsequent app launch re-throws trying to parse that same
 * corrupted value, forever.
 *
 * get() is the only method that can encounter this (put/del write, they
 * don't parse existing data). If the underlying adapter throws, we treat
 * it as "this key is unrecoverable" -- delete it and return undefined, so
 * Privy proceeds as if there was never a stored session (same as a fresh
 * install), instead of the whole provider getting stuck.
 */
export const resilientPrivyStorage = {
  async get(key: string): Promise<unknown> {
    try {
      return await SecureStorageAdapter.get(key);
    } catch (err) {
      console.error(`resilientPrivyStorage: corrupted value at "${key}", clearing it`, err);
      try {
        await SecureStorageAdapter.del(key);
      } catch {
        // best-effort cleanup -- if delete also fails, we've still stopped
        // this get() call from throwing, which is the part that mattered.
      }
      return undefined;
    }
  },
  put(key: string, value: unknown) {
    return SecureStorageAdapter.put(key, value);
  },
  del(key: string) {
    return SecureStorageAdapter.del(key);
  },
  getKeys() {
    return SecureStorageAdapter.getKeys();
  },
};
