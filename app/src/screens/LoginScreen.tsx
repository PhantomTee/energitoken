import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native"; // Platform kept for iOS keyboard behavior
import { useRouter } from "expo-router";
import { useLoginWithEmail, useEmbeddedEthereumWallet } from "@privy-io/expo";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { AdinkraAccent } from "../theme/motifs/AdinkraAccent";
import { recordFullLogin } from "../services/quickAuth";
import { markJustLoggedIn } from "../services/loginFlag";
import { friendlyAuthError } from "../services/authErrors";
import { OtpInput } from "../components/OtpInput";
import { Ionicons } from "@expo/vector-icons";

/**
 * Privy's mobile SDK authenticates by emailing a one-time 6-digit code
 * (not a clickable magic link — that's the web flow; codes are what work
 * reliably inside a native app). On a successful first login Privy creates
 * the embedded wallet automatically (config in src/screens/RootLayout.tsx).
 */
export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const { create: createEthereumWallet } = useEmbeddedEthereumWallet();

  // No callbacks passed to useLoginWithEmail -- inline onError/onLoginSuccess
  // functions get a new reference on every render (every keystroke in the
  // code field), and Privy's hook resets its internal OTP session state
  // when it sees the options object change. That reset was the likely real
  // cause of intermittent login failures: the web screen already had this
  // exact bug documented and fixed; the native screen still had it. Drive
  // everything from state.status instead, same pattern as the web screen.
  const { sendCode, loginWithCode, state } = useLoginWithEmail();

  // ── Completion handler ───────────────────────────────────────────────────
  useEffect(() => {
    if (state.status !== "done") return;
    setCompleting(true);
    (async () => {
      try {
        // createOnLogin: "users-without-wallets" already covers this, but
        // calling create() again is a safe no-op if a wallet already exists.
        try {
          await createEthereumWallet();
        } catch {
          // wallet likely already exists — fine to ignore
        }
        // Starts this device's 12h quick-unlock window (src/services/quickAuth.ts).
        await recordFullLogin();
        // Hand off to "/" (index.tsx) — it checks device pairing and sends
        // new users to onboarding instead of an unpaired dashboard. The flag
        // skips the biometric detour that cold starts get.
        markJustLoggedIn();
        router.replace("/");
      } finally {
        setCompleting(false);
      }
    })();
  }, [state.status, createEthereumWallet, router]);

  // ── Error handler ────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.status !== "error") return;
    const msg = state.error?.message ?? "Something went wrong. Please try again.";
    setError(friendlyAuthError(msg));
  }, [state.status, state]);

  const awaitingCode = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const sendingCode = state.status === "sending-code";

  const handleSendCode = async () => {
    setError(null);
    if (!email.includes("@")) return;
    try {
      await sendCode({ email });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(friendlyAuthError(msg) || "Couldn't send the code. Please try again.");
    }
  };

  const handleSubmitCode = async (submittedCode: string) => {
    setError(null);
    if (submittedCode.length < 4) return;
    try {
      await loginWithCode({ code: submittedCode, email });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(friendlyAuthError(msg) || "Couldn't verify the code. Please try again.");
    }
  };

  // Auto-submit once all 6 digits are entered -- no separate "Verify" tap
  // needed, matching the spec's auto-focus/auto-advance OTP box behaviour.
  useEffect(() => {
    if (code.length === 6 && state.status === "awaiting-code-input") {
      handleSubmitCode(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* On web this View centres itself; on native it fills the screen */}
      <View style={styles.outer}>
        <View style={styles.header}>
          <View style={styles.badge}>
            <AdinkraAccent size={36} color={colors.indigo[900]} dotColor={colors.terracotta[500]} opacity={1} />
          </View>
          <Text style={[typography.h1, styles.wordmark]}>EnergiToken</Text>
        </View>

        <View style={styles.card}>
          <Text style={[typography.label, styles.cardLabel]}>
            {completing ? "SETTING UP" : awaitingCode ? "VERIFY CODE" : "SECURE ACCESS"}
          </Text>
          <Text style={[typography.caption, styles.subtitle]}>
            {completing
              ? "Setting up your wallet..."
              : awaitingCode
                ? `Enter the code we sent to ${email}.`
                : "Sign in with your email to see your household's energy budget and credit balance."}
          </Text>

          {completing ? (
            <ActivityIndicator color={colors.terracotta[500]} size="large" style={styles.completingSpinner} />
          ) : !awaitingCode ? (
            <>
              <View style={styles.inputRow}>
                <Ionicons name="mail-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  placeholderTextColor={colors.neutral[500]}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!sendingCode}
                />
              </View>
              <Pressable
                style={[styles.button, (!email.includes("@") || sendingCode) && styles.buttonDisabled]}
                onPress={handleSendCode}
                disabled={!email.includes("@") || sendingCode}
              >
                {sendingCode ? (
                  <ActivityIndicator color={colors.neutral.white} />
                ) : (
                  <Text style={[typography.bodyStrong, styles.buttonText]}>Continue  →</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <OtpInput
                value={code}
                onChangeText={setCode}
                editable={state.status !== "submitting-code" && !completing}
                autoFocus
              />
              <Pressable
                style={[styles.button, (code.length < 6 || state.status === "submitting-code" || completing) && styles.buttonDisabled]}
                onPress={() => handleSubmitCode(code)}
                disabled={code.length < 6 || state.status === "submitting-code" || completing}
              >
                {state.status === "submitting-code" || completing ? (
                  <ActivityIndicator color={colors.neutral.white} />
                ) : (
                  <Text style={[typography.bodyStrong, styles.buttonText]}>Verify & sign in</Text>
                )}
              </Pressable>
            </>
          )}

          {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}
        </View>

        <Text style={[typography.caption, styles.footnote]}>
          By continuing, you agree to secure data handling.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const isWeb = Platform.OS === "web";

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.indigo[900],
    alignItems: "center",
    justifyContent: "center",
  },
  outer: {
    width: isWeb ? 440 : "100%",
    paddingHorizontal: isWeb ? 0 : spacing.xl,
    alignItems: "center",
  },
  header: { alignItems: "center", marginBottom: spacing.xxl },
  badge: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.indigo[100],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  wordmark: { color: colors.neutral.white },
  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  cardLabel: { color: colors.textSecondary, textAlign: "center", marginBottom: spacing.md },
  subtitle: { color: colors.textSecondary, marginBottom: spacing.lg, textAlign: "center" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  inputIcon: { color: colors.textSecondary, marginRight: spacing.sm },
  input: {
    flex: 1,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
    fontSize: 16,
    fontFamily: typography.body.fontFamily,
  },
  button: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.neutral.white },
  errorText: { color: colors.danger, marginTop: spacing.md, textAlign: "center" },
  completingSpinner: { marginTop: spacing.xl },
  footnote: { color: colors.indigo[100], marginTop: spacing.xl, textAlign: "center", opacity: 0.85 },
});
