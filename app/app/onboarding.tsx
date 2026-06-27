import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";
import { AdinkraAccent } from "../src/theme/motifs/AdinkraAccent";
import { useWallet } from "../src/hooks/useWallet";
import { ensureFirebaseSession } from "../src/services/firebaseSession";
import { claimDevice, DEVICE_CODE_PATTERN } from "../src/services/deviceBinding";

/**
 * Shown once, right after first login, when the wallet has no device bound
 * yet. The device code is the last 6 hex characters of the ESP32's MAC
 * address, printed on the meter's LCD during setup -- see firebase/schema.md.
 * Until a real meter exists, run firebase/seed.ts to seed the mock device
 * "3B9D88" and enter that here to test the flow end to end.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const { walletAddress } = useWallet();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidFormat = DEVICE_CODE_PATTERN.test(code.trim());

  const handleSubmit = async () => {
    if (!walletAddress || !isValidFormat) return;
    setSubmitting(true);
    setError(null);
    try {
      await ensureFirebaseSession(walletAddress);
      await claimDevice(code, walletAddress);
      router.replace("/(tabs)/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong linking that device.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.accentTopRight}>
        <AdinkraAccent size={80} color={colors.terracotta[400]} opacity={0.18} />
      </View>

      <View style={styles.content}>
        <Text style={[typography.label, styles.brandLabel]}>ONE LAST STEP</Text>
        <Text style={[typography.display, styles.title]}>Link your{"\n"}meter.</Text>
        <Text style={[typography.body, styles.subtitle]}>
          Enter the 6-character device code shown on your EnergiToken meter's display. This
          links your wallet to that household's energy data.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="3B9D88"
          placeholderTextColor={colors.neutral[500]}
          value={code}
          onChangeText={(text) => setCode(text.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          editable={!submitting}
        />
        {code.length > 0 && !isValidFormat && (
          <Text style={[typography.caption, styles.errorText]}>
            Device code must be 6 characters, 0-9 and A-F only.
          </Text>
        )}
        {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}

        <Pressable
          style={[styles.button, (!isValidFormat || submitting) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!isValidFormat || submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.neutral.white} />
          ) : (
            <Text style={[typography.bodyStrong, styles.buttonText]}>Link device</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.indigo[900] },
  accentTopRight: { position: "absolute", top: spacing.xl, right: spacing.lg },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl },
  brandLabel: { color: colors.terracotta[300], marginBottom: spacing.md },
  title: { color: colors.neutral.white, marginBottom: spacing.md },
  subtitle: { color: colors.indigo[100], marginBottom: spacing.xl, opacity: 0.85 },
  input: {
    backgroundColor: colors.neutral.white,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 20,
    letterSpacing: 4,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  errorText: { color: colors.terracotta[300], marginBottom: spacing.md },
  button: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.neutral.white },
});
