import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useLoginWithEmail, useEmbeddedEthereumWallet } from "@privy-io/expo";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";
import { AdinkraAccent } from "../src/theme/motifs/AdinkraAccent";

/**
 * Privy's mobile SDK authenticates by emailing a one-time 6-digit code
 * (not a clickable magic link — that's the web flow; codes are what work
 * reliably inside a native app). On a successful first login Privy creates
 * the embedded wallet automatically (config in app/_layout.tsx).
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
      router.replace("/(tabs)/dashboard");
    },
  });

  const awaitingCode = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const sendingCode = state.status === "sending-code";

  const handleSendCode = async () => {
    setError(null);
    if (!email.includes("@")) return;
    await sendCode({ email });
  };

  const handleSubmitCode = async () => {
    setError(null);
    if (code.length < 4) return;
    await loginWithCode({ code, email });
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.accentTopRight}>
        <AdinkraAccent size={96} color={colors.terracotta[500]} />
      </View>

      <View style={styles.content}>
        <Text style={[typography.label, styles.brandLabel]}>ENERGITOKEN</Text>
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
              style={styles.input}
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
    fontSize: 16,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.neutral.white },
  errorText: { color: colors.terracotta[300], marginTop: spacing.md },
});
