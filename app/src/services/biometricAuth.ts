import * as LocalAuthentication from "expo-local-authentication";

/** True if the device has biometric hardware with at least one enrolled fingerprint/face. */
export async function isBiometricAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return hasHardware && isEnrolled;
}

/**
 * Prompts fingerprint/Face ID, falling back to the device's own PIN/pattern/
 * password screen (disableDeviceFallback: false) if biometrics fail or
 * aren't enrolled -- matching "fingerprint or PIN" rather than biometric-only.
 */
export async function promptBiometricUnlock(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock EnergiToken",
    disableDeviceFallback: false,
    cancelLabel: "Cancel",
  });
  return result.success;
}
