import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";
import { AdinkraAccent } from "../src/theme/motifs/AdinkraAccent";
import { useWallet } from "../src/hooks/useWallet";
import { ensureFirebaseSession, clearFirebaseSession } from "../src/services/firebaseSession";
import { claimDevice, DEVICE_CODE_PATTERN } from "../src/services/deviceBinding";
import { QRScanner } from "../src/components/QRScanner";
import { Ionicons } from "@expo/vector-icons";

/**
 * Shown once, right after first login, when the wallet has no device bound
 * yet. The device code is the last 6 hex characters of the ESP32's MAC
 * address, printed on the meter's LCD during setup -- see firebase/schema.md.
 * Until a real meter exists, run firebase/seed.ts to seed the mock device
 * "3B9D88" and enter that here to test the flow end to end.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const { walletAddress, isReady, isAuthenticated, logout } = useWallet();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);

  // Guard: anyone here without a full session (auth + wallet) goes to login,
  // which owns the recovery path for wallet-less accounts.
  React.useEffect(() => {
    if (isReady && (!isAuthenticated || !walletAddress)) {
      router.replace("/login");
    }
  }, [isReady, isAuthenticated, walletAddress, router]);

  const isValidFormat = DEVICE_CODE_PATTERN.test(code.trim());

  // Reached from index.tsx's routing brain via <Redirect>, which replaces
  // rather than pushes -- for a fresh login with no device yet, there's
  // genuinely no prior screen in history, so router.back() would silently
  // no-op. When that's the case, "back" undoes step 1 (login) instead.
  const handleBack = async () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    await clearFirebaseSession();
    await logout();
    router.replace("/login");
  };

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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.card}>
        <View style={styles.stepRow}>
          <Pressable hitSlop={12} onPress={handleBack}>
            <Text style={styles.backArrow}>←</Text>
          </Pressable>
          <Text style={[typography.label, styles.stepLabel]}>STEP 2 OF 3</Text>
        </View>

        <View style={styles.iconWrap}>
          <AdinkraAccent size={40} color={colors.indigo[900]} dotColor={colors.terracotta[500]} opacity={1} />
        </View>
        <Text style={[typography.h1, styles.title]}>Connect Your Meter</Text>
        <Text style={[typography.body, styles.subtitle]}>
          Link your smart meter to start tracking your energy consumption and savings.
        </Text>

        {Platform.OS !== "web" && (
          <Pressable style={styles.scanRow} onPress={() => setScannerVisible(true)} disabled={submitting}>
            <Ionicons name="qr-code-outline" size={22} color={colors.textPrimary} />
            <View style={styles.scanRowBody}>
              <Text style={[typography.bodyStrong, styles.scanRowTitle]}>Scan QR Code</Text>
              <Text style={[typography.caption, styles.scanRowSubtitle]}>Fastest way to connect</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={[typography.label, styles.dividerText]}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.manualCard}>
          <Text style={[typography.label, styles.manualLabel]}>MANUAL ENTRY (6 CHARACTERS)</Text>
          <View style={styles.manualRow}>
            <TextInput
              style={styles.manualInput}
              placeholder="e.g. A1B2C3"
              placeholderTextColor={colors.neutral[500]}
              value={code}
              onChangeText={(text) => setCode(text.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              editable={!submitting}
            />
            <Pressable
              onPress={handleSubmit}
              disabled={!isValidFormat || submitting}
              hitSlop={8}
            >
              {submitting ? (
                <ActivityIndicator color={colors.indigo[500]} />
              ) : (
                <Text
                  style={[
                    typography.bodyStrong,
                    styles.linkAction,
                    (!isValidFormat || submitting) && styles.linkActionDisabled,
                  ]}
                >
                  LINK
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        {code.length > 0 && !isValidFormat && (
          <Text style={[typography.caption, styles.errorText]}>
            Device code must be 6 characters, 0-9 and A-F only.
          </Text>
        )}
        {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}
      </View>

      <QRScanner
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        title="Scan the QR code on your meter"
        onScanned={(data) => {
          setScannerVisible(false);
          const match = data.toUpperCase().match(/[0-9A-F]{6}/);
          setCode(match ? match[0] : data.toUpperCase().slice(0, 6));
          setError(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  card: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    margin: spacing.lg,
  },
  stepRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xl },
  backArrow: { color: colors.textPrimary, fontSize: 20 },
  stepLabel: { color: colors.textSecondary },
  iconWrap: { alignItems: "center", marginBottom: spacing.md },
  title: { color: colors.textPrimary, textAlign: "center", marginBottom: spacing.sm },
  subtitle: { color: colors.textSecondary, textAlign: "center", marginBottom: spacing.xl },
  scanRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  scanRowBody: { flex: 1 },
  scanRowTitle: { color: colors.textPrimary },
  scanRowSubtitle: { color: colors.textSecondary },
  chevron: { fontSize: 20, color: colors.textSecondary },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textSecondary },
  manualCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  manualLabel: { color: colors.textSecondary, marginBottom: spacing.sm },
  manualRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  manualInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 18,
    letterSpacing: 3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
    fontFamily: typography.dataMd.fontFamily,
  },
  linkAction: { color: colors.indigo[500] },
  linkActionDisabled: { color: colors.textSecondary, opacity: 0.5 },
  errorText: { color: colors.danger, marginTop: spacing.md },
});
