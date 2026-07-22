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
  const [rawError, setRawError] = useState<string | null>(null);
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
    setRawError(msg);
  }, [state.status, state]);

  const awaitingCode = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const sendingCode = state.status === "sending-code";

  const handleSendCode = async () => {
    setError(null);
    setRawError(null);
    if (!email.includes("@")) return;
    try {
      await sendCode({ email });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(friendlyAuthError(msg) || "Couldn't send the code. Please try again.");
      setRawError(msg);
    }
  };

  const handleSubmitCode = async () => {
    setError(null);
    setRawError(null);
    if (code.length < 4) return;
    try {
      await loginWithCode({ code, email });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(friendlyAuthError(msg) || "Couldn't verify the code. Please try again.");
      setRawError(msg);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.accentTopRight}>
        <AdinkraAccent size={96} color={colors.terracotta[500]} />
      </View>

      {/* On web this View centres itself; on native it fills the screen */}
      <View style={styles.outer}>
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <AdinkraAccent size={22} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
          <Text style={[typography.label, styles.brandLabel]}>ENERGITOKEN</Text>
        </View>
        <Text style={[typography.display, styles.title]}>Power, budgeted{"\n"}and shared.</Text>
        <Text style={[typography.body, styles.subtitle]}>
          {awaitingCode
            ? `Enter the code we sent to ${email}.`
            : "Sign in with your email to see your household's energy budget and credit balance."}
        </Text>

        {!awaitingCode ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.neutral[500]}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!sendingCode}
            />
            <Pressable
              style={[styles.button, (!email.includes("@") || sendingCode) && styles.buttonDisabled]}
              onPress={handleSendCode}
              disabled={!email.includes("@") || sendingCode}
            >
              {sendingCode ? (
                <ActivityIndicator color={colors.neutral.white} />
              ) : (
                <Text style={[typography.bodyStrong, styles.buttonText]}>Continue with email</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="6-digit code"
              placeholderTextColor={colors.neutral[500]}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              editable={state.status !== "submitting-code" && !completing}
            />
            <Pressable
              style={[styles.button, (code.length < 4 || state.status === "submitting-code" || completing) && styles.buttonDisabled]}
              onPress={handleSubmitCode}
              disabled={code.length < 4 || state.status === "submitting-code" || completing}
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
        {rawError && <Text style={[typography.caption, styles.rawErrorText]}>Debug: {rawError}</Text>}
      </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const isWeb = Platform.OS === "web";

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.indigo[900],
    alignItems: isWeb ? "center" : "stretch",
    justifyContent: "center",
  },
  accentTopRight: { position: "absolute", top: spacing.xl, right: spacing.lg },
  outer: {
    width: isWeb ? 440 : "100%",
    flex: isWeb ? 0 : 1,
  },
  content: {
    flex: isWeb ? 0 : 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: isWeb ? 48 : 0,
    ...(isWeb ? { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 18 } : {}),
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  brandLabel: { color: colors.terracotta[300] },
  title: { color: colors.neutral.white, marginBottom: spacing.md },
  subtitle: { color: colors.indigo[100], marginBottom: spacing.xl, opacity: 0.85 },
  input: {
    backgroundColor: colors.panelInset,
    color: colors.panelInsetText,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    fontFamily: typography.body.fontFamily,
    marginBottom: spacing.md,
  },
  codeInput: { fontFamily: typography.dataMd.fontFamily, fontSize: 22, letterSpacing: 4 },
  button: {
    backgroundColor: colors.terracotta[400],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.neutral.white },
  errorText: { color: colors.terracotta[300], marginTop: spacing.md },
  rawErrorText: { color: colors.indigo[300], marginTop: spacing.xs, opacity: 0.7 },
});
