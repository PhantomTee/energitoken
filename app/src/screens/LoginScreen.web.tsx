import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useLoginWithEmail, useCreateWallet, usePrivy } from "@privy-io/react-auth";
import { useWallet } from "../hooks/useWallet";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { AdinkraAccent } from "../theme/motifs/AdinkraAccent";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Once the user successfully sends the OTP we must NEVER hide the form with
  // a spinner again — Privy v3 can briefly flip isAuthenticated=true with no
  // wallet while it hydrates a recognised email, which would otherwise cover
  // the code-entry field and leave the user stuck.
  const otpSent = useRef(false);
  const didNavigate = useRef(false);

  const { isReady, isAuthenticated, walletAddress } = useWallet();
  const { ready } = usePrivy();
  const { create: createWallet } = useCreateWallet();

  // Redirect once we have a confirmed wallet address.
  // Fires both for returning users (cold load) and after a fresh login.
  useEffect(() => {
    if (isReady && isAuthenticated && walletAddress && !didNavigate.current) {
      didNavigate.current = true;
      router.replace("/(tabs)/dashboard");
    }
  }, [isReady, isAuthenticated, walletAddress, router]);

  const { sendCode, loginWithCode, state } = useLoginWithEmail({
    onComplete: async () => {
      try { await createWallet(); } catch { /* wallet already exists — fine */ }
      // Navigation is handled by the useEffect above once walletAddress resolves.
    },
    onError: (err) => setError((err as Error).message ?? "Something went wrong. Please try again."),
  });

  const awaitingCode = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const sendingCode  = state.status === "sending-code";

  const handleSendCode = async () => {
    setError(null);
    if (!email.includes("@")) return;
    try {
      await sendCode({ email });
      // Mark OTP as sent — prevents the auth-state spinner from hiding the
      // code-entry form even if Privy briefly sets authenticated=true before
      // the wallet address is available (partial session hydration).
      otpSent.current = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("aborted")
          ? "Connection timed out. Please check your network and try again."
          : msg || "Couldn't send the code. Please try again."
      );
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

  // Show a full-screen spinner only while:
  //   1. Privy SDK is still initialising  (!ready)
  //   2. Returning user: authenticated but wallet address not yet resolved —
  //      redirect is about to fire so no need to show the form
  //
  // Critically: once otpSent is true we are mid-flow and MUST show the form
  // regardless of any transient auth-state changes Privy makes in the background.
  const isLoading = !ready || (!otpSent.current && isAuthenticated && !walletAddress);

  if (isLoading) {
    return (
      <View style={styles.screenCenter}>
        <ActivityIndicator size="large" color={colors.indigo[400]} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.accentTopRight}>
        <AdinkraAccent size={96} color={colors.terracotta[500]} />
      </View>

      <View style={styles.card}>
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
              {sendingCode
                ? <ActivityIndicator color={colors.neutral.white} />
                : <Text style={[typography.bodyStrong, styles.buttonText]}>Continue with email</Text>}
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
              {state.status === "submitting-code"
                ? <ActivityIndicator color={colors.neutral.white} />
                : <Text style={[typography.bodyStrong, styles.buttonText]}>Verify & sign in</Text>}
            </Pressable>
          </>
        )}

        {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.indigo[900],
    alignItems: "center",
    justifyContent: "center",
  },
  screenCenter: {
    flex: 1,
    backgroundColor: colors.indigo[900],
    alignItems: "center",
    justifyContent: "center",
  },
  accentTopRight: { position: "absolute", top: spacing.xl, right: spacing.lg },
  card: {
    width: 440,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 18,
    paddingHorizontal: 40,
    paddingVertical: 48,
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
