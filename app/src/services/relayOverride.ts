import { ref, set, remove } from "firebase/database";
import { db } from "./firebase";
import { RelayState } from "../mock/mockMeterData";

export type RelayTierKey = keyof RelayState;

/**
 * Sets a manual override for one relay tier, or clears it back to "auto".
 * `value: true` forces the load on, `false` forces it off, `null` removes
 * the override so firmware's own budget-shedding logic decides again.
 *
 * Firmware (once it exists) is expected to check /meters/{deviceId}/relayOverrides/{tier}
 * before applying its automatic decision for that tier -- see firebase/schema.md.
 */
export async function setRelayOverride(
  deviceId: string,
  tier: RelayTierKey,
  value: boolean | null
): Promise<void> {
  const overrideRef = ref(db, `meters/${deviceId}/relayOverrides/${tier}`);
  if (value === null) {
    await remove(overrideRef);
  } else {
    await set(overrideRef, value);
  }
}
