import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useLoginWithEmail, useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { AdinkraAccent } from "../theme/motifs/AdinkraAccent";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pendingNav = useRef(false);

  const { ready, authenticated, logout } = usePrivy();
  const { wallets } = useWallets();
  const { create: createWallet } = useCreateWallet();

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");

  // Redirect to dashboard whenever we have a confirmed embedded wallet.
  useEffect(() => {
    if (ready && authenticated && embeddedWallet?.address) {
      router.replace("/(tabs)/dashboard");
    }
  }, [ready, authenticated, embeddedWallet, router]);

  // When Privy says we're authenticated but wallets[] is still empty, it means
  // either (a) wallets[] is still loading async, or (b) the wallet was never
  // created (edge case). Proactively try createWallet() after a short settling
  // delay. If that also fails, log out so the user can sign in fresh.
  useEffect(() => {
    if (!ready || !authenticated || embeddedWallet) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        await createWallet();
        // If successful, wallets[] will update and the redirect useEffect fires.
      } catch {
        // Wallet likely already exists but isn't in wallets[] — or creation truly
        // failed. Log out so the user lands on a clean login form.
        if (!cancelled) await logout();
      }
    }, 2500); // 2.5s settling window for wallets[] to populate normally

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, authenticated, embeddedWallet, createWallet, logout]);

  const { sendCode, loginWithCode, state } = useLoginWithEmail({
    onComplete: async () => {
      try { await createWallet(); } catch { /* wallet already exists — fine */ }
      pendingNav.current = true;
      // useEffect above will fire when wallets[] updates with the new wallet.
    },
    onError: (err) => setError((err as Error).message ?? "Something went wrong. Please try again."),
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

  // Show spinner while:
  //   - Privy SDK is still initialising (!ready)
  //   - User is authenticated but wallet hasn't appeared in wallets[] yet
  //     (prevents the form appearing in the gap, which causes "already linked" error)
  const isLoading = !ready || (authenticated && !embeddedWallet);

  if (isLoading) {
    return (
      <View style={[styles.screen, { justifyContent: "center", alignItems: "center" }]}>
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
