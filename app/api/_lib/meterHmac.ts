import { createHmac, timingSafeEqual } from "crypto";

/**
 * Consumption-report integrity for a single link: meter -> Firebase.
 *
 * The meter authenticates to Firebase with one shared database secret --
 * a bearer credential every device has, that grants full read/write across
 * the whole database if it ever leaks. That's fine for the raw display
 * fields (voltage, power, etc.), but energyWh feeds directly into burnConsumed
 * and setPendingBurn, i.e. it moves real token balance. This signs that one
 * field with a key unique to each device, so a leaked shared secret can
 * still forge what a dashboard *shows*, but can no longer forge a reading
 * this oracle will actually burn tokens against.
 *
 * Each device's key is derived, never stored per-device: deriveDeviceKey
 * computes HMAC(masterSecret, deviceId), so the server only ever holds one
 * secret (METER_HMAC_MASTER_SECRET) and can recompute any device's key on
 * demand. The firmware, conversely, is flashed with only ITS OWN derived
 * key baked in at build time -- it never sees the master secret, so
 * extracting one device's flash doesn't expose any other device's key.
 */

function masterSecret(): Buffer {
  const secret = process.env.METER_HMAC_MASTER_SECRET;
  if (!secret) throw new Error("METER_HMAC_MASTER_SECRET is not configured");
  return Buffer.from(secret, "hex");
}

export function deriveDeviceKey(deviceId: string): Buffer {
  return createHmac("sha256", masterSecret()).update(deviceId).digest();
}

/**
 * energyWhInt is a separate integer-Wh field from the display-only float
 * `energyWh` specifically so the signed message has one unambiguous byte
 * representation on both sides -- floating-point-to-string formatting can
 * differ between the firmware's C++ and this file's JS in ways that would
 * make a genuinely-valid signature fail to verify for no real reason.
 */
export function verifyMeterSignature(deviceId: string, energyWhInt: number, sigHex: string | undefined): boolean {
  if (!sigHex || !/^[0-9a-f]{64}$/i.test(sigHex)) return false;

  let expected: Buffer;
  try {
    expected = createHmac("sha256", deriveDeviceKey(deviceId))
      .update(`${deviceId}:${energyWhInt}`)
      .digest();
  } catch {
    return false; // master secret not configured -- fail closed, not open
  }

  const received = Buffer.from(sigHex, "hex");
  // Both are fixed-size 32-byte HMAC-SHA256 digests, so a direct
  // timingSafeEqual is safe here without the extra length-padding trick
  // verifyWebhookSignature needs for its variable-length string compare.
  return received.length === expected.length && timingSafeEqual(received, expected);
}
