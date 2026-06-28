import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";
import { AdinkraAccent } from "../src/theme/motifs/AdinkraAccent";
import { useWallet } from "../src/hooks/useWallet";
import { promptBiometricUnlock } from "../src/services/biometricAuth";
import { clearFullLogin } from "../src/services/quickAuth";
import { resolvePostAuthDestination } from "../src/services/postAuthRouting";

/**
 * Native-only quick-unlock gate -- reached from index.tsx whenever the user
 * is already authenticated with Privy and within the 12h quick-auth window
 * (see src/services/quickAuth.ts). A fingerprint/Face ID/PIN check stands
 * in for a full email-code login here; "Use email code instead" is the
 * escape hatch if biometrics aren't set up or fail.
 */
export default function UnlockScreen() {
  const router = useRouter();
  const { walletAddress, logout } = useWallet();
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attemptUnlock = useCallback(async () => {
    if (!walletAddress) return;
    setUnlocking(true);
    setError(null);
    try {
      const success = await promptBiometricUnlock();
      if (!success) {
        setError("Couldn't verify it's you. Try again, or use your email code.");
        return;
      }
      const destination = await resolvePostAuthDestination(walletAddress);
      router.replace(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUnlocking(false);
    }
  }, [walletAddress, router]);

  useEffect(() => {
    attemptUnlock();
  }, [attemptUnlock]);

  const handleUseCodeInstead = async () => {
    await clearFullLogin();
    await logout();
    router.replace("/login");
  };

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <AdinkraAccent size={64} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
        <Text style={[typography.h1, styles.title]}>Welcome back</Text>
        <Text style={[typography.body, styles.subtitle]}>
          Verify it's you with your fingerprint or device PIN to continue.
        </Text>

        {unlocking && <ActivityIndicator color={colors.indigo[400]} style={styles.spinner} />}
        {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}

        <Pressable style={[styles.button, unlocking && styles.buttonDisabled]} onPress={attemptUnlock} disabled={unlocking}>
          <Text style={[typography.bodyStrong, styles.buttonText]}>Try again</Text>
        </Pressable>
        <Pressable onPress={handleUseCodeInstead} disabled={unlocking}>
          <Text style={[typography.caption, styles.linkText]}>Use email code instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.indigo[900] },
  content: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  title: { color: colors.neutral.white, marginTop: spacing.sm },
  subtitle: { color: colors.indigo[100], textAlign: "center", opacity: 0.85 },
  spinner: { marginTop: spacing.sm },
  errorText: { color: colors.terracotta[300], textAlign: "center" },
  button: {
    backgroundColor: colors.terracotta[400],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.neutral.white },
  linkText: { color: colors.indigo[300], textDecorationLine: "underline", marginTop: spacing.sm },
});
