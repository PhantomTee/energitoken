import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useLoginWithEmail, useEmbeddedEthereumWallet } from "@privy-io/expo";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { AdinkraAccent } from "../theme/motifs/AdinkraAccent";
import { recordFullLogin } from "../services/quickAuth";

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

  const { create: createEthereumWallet } = useEmbeddedEthereumWallet();

  const { sendCode, loginWithCode, state } = useLoginWithEmail({
    onError: (err) => setError(err.message ?? "Something went wrong. Please try again."),
    onLoginSuccess: async () => {
      // createOnLogin: "users-without-wallets" already covers this, but calling
      // create() again is a safe no-op if a wallet already exists.
      try {
        await createEthereumWallet();
      } catch {
        // wallet likely already exists — fine to ignore
      }
      // Starts this device's 12h quick-unlock window (src/services/quickAuth.ts).
      await recordFullLogin();
      router.replace("/(tabs)/dashboard");
    },
  });

  const awaitingCode = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const sendingCode = state.status === "sending-code";

  const handleSendCode = async () => {
    setError(null);
    if (!email.includes("@")) return;
    try {
      await sendCode({ email });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("aborted")) {
        setError("Connection timed out. Please check your network and try again.");
      } else {
        setError(msg || "Couldn't send the code. Please try again.");
      }
    }
  };

  const handleSubmitCode = async () => {
    setError(null);
    if (code.length < 4) return;
    try {
      await loginWithCode({ code, email });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Couldn't verify the code. Please try again.");
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.accentTopRight}>
        <AdinkraAccent size={96} color={colors.terracotta[500]} />
      </View>

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
              editable={state.status !== "submitting-code"}
            />
            <Pressable
              style={[styles.button, (code.length < 4 || state.status === "submitting-code") && styles.buttonDisabled]}
              onPress={handleSubmitCode}
              disabled={code.length < 4 || state.status === "submitting-code"}
            >
              {state.status === "submitting-code" ? (
                <ActivityIndicator color={colors.neutral.white} />
              ) : (
                <Text style={[typography.bodyStrong, styles.buttonText]}>Verify & sign in</Text>
              )}
            </Pressable>
          </>
        )}

        {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.indigo[900],
    justifyContent: "center",
  },
  accentTopRight: { position: "absolute", top: spacing.xl, right: spacing.lg },
  content: Platform.OS === "web"
    ? {
        alignSelf: "center" as const,
        width: 440,
        paddingHorizontal: spacing.xl,
        paddingVertical: 48,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderRadius: 16,
      }
    : {
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: spacing.xl,
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
});
