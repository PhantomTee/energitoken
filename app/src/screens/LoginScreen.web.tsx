import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useLoginWithEmail, useCreateWallet, usePrivy } from "@privy-io/react-auth";
import { useWallet } from "../hooks/useWallet";
import { markJustLoggedIn } from "../services/loginFlag";
import { friendlyAuthError } from "../services/authErrors";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { AdinkraAccent } from "../theme/motifs/AdinkraAccent";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Set to true once sendCode() succeeds — prevents a transient
  // isAuthenticated=true (Privy v3 partial hydration) from hiding the form.
  const otpSent = useRef(false);
  const didNavigate = useRef(false);

  const { isReady, isAuthenticated, walletAddress } = useWallet();
  const { ready, logout } = usePrivy();
  // NB: the v3 hook exposes `createWallet`, NOT `create` — destructuring the
  // wrong name made this undefined and silently broke wallet creation.
  const { createWallet } = useCreateWallet();

  // No callbacks passed to useLoginWithEmail — inline arrow functions create
  // new references on every render, which can cause Privy's hook to reset its
  // internal email session state, producing "invalid email and code combination".
  // Drive everything from state.status instead.
  const { sendCode, loginWithCode, state } = useLoginWithEmail();

  // ── Completion handler ───────────────────────────────────────────────────
  // When Privy marks the OTP flow as done, create the embedded wallet (no-op
  // for existing users). The redirect fires from the walletAddress effect below.
  useEffect(() => {
    if (state.status !== "done") return;
    createWallet().catch(() => {/* wallet already exists */});
  }, [state.status, createWallet]);

  // ── Error handler ────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.status !== "error") return;
    const msg = state.error?.message ?? "Something went wrong. Please try again.";
    setFormError(friendlyAuthError(msg));
  }, [state.status, state]);

  // ── Redirect once wallet is confirmed ────────────────────────────────────
  // Hand control back to "/" (index.tsx) — it decides onboarding vs dashboard.
  // If this was a fresh OTP login (not a returning session), mark it so index
  // skips any cold-start detours.
  useEffect(() => {
    if (isReady && isAuthenticated && walletAddress && !didNavigate.current) {
      didNavigate.current = true;
      if (otpSent.current) markJustLoggedIn();
      router.replace("/");
    }
  }, [isReady, isAuthenticated, walletAddress, router]);

  // ── Recovery: authenticated account with NO embedded wallet ─────────────
  // walletAddress comes from user.linkedAccounts (instant), so if we're
  // authenticated and it's still null after a grace period, the wallet
  // genuinely doesn't exist (creation failed at signup). Try creating it
  // once; if that doesn't produce a wallet, log out to a clean form rather
  // than leaving the user on an infinite spinner. Skipped mid-OTP-flow.
  useEffect(() => {
    if (!ready || !isAuthenticated || walletAddress || otpSent.current) return;

    let cancelled = false;
    const createTimer = setTimeout(() => {
      if (!cancelled) createWallet().catch(() => {/* handled by logout timer */});
    }, 3000);
    const bailTimer = setTimeout(() => {
      if (!cancelled) logout().catch(() => {});
    }, 10000);

    return () => {
      cancelled = true;
      clearTimeout(createTimer);
      clearTimeout(bailTimer);
    };
  }, [ready, isAuthenticated, walletAddress, createWallet, logout]);

  const awaitingCode = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const sendingCode  = state.status === "sending-code";

  const handleSendCode = async () => {
    setFormError(null);
    if (!email.trim().includes("@")) return;
    try {
      await sendCode({ email: email.trim().toLowerCase() });
      otpSent.current = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(friendlyAuthError(msg) || "Couldn't send the code. Please try again.");
    }
  };

  const handleSubmitCode = async () => {
    setFormError(null);
    const trimmed = code.trim();
    if (trimmed.length < 4) return;
    try {
      await loginWithCode({ code: trimmed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(friendlyAuthError(msg) || "Couldn't verify the code. Please try again.");
    }
  };

  // Show full-screen spinner only while SDK initialises or a returning user's
  // wallet address is resolving (redirect is imminent). Never show it once the
  // OTP has been sent — that would hide the code-entry field.
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
            ? `Enter the 6-digit code we sent to ${email}.`
            : "Sign in with your email to see your household's energy budget and credit balance."}
        </Text>

        {!awaitingCode ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.neutral[500]}
              value={email}
              onChangeText={(t) => { setEmail(t); setFormError(null); }}
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
              placeholder="123456"
              placeholderTextColor={colors.neutral[500]}
              value={code}
              onChangeText={(t) => { setCode(t); setFormError(null); }}
              keyboardType="number-pad"
              maxLength={6}
              editable={state.status !== "submitting-code"}
            />
            <Pressable
              style={[styles.button, (code.trim().length < 4 || state.status === "submitting-code") && styles.buttonDisabled]}
              onPress={handleSubmitCode}
              disabled={code.trim().length < 4 || state.status === "submitting-code"}
            >
              {state.status === "submitting-code"
                ? <ActivityIndicator color={colors.neutral.white} />
                : <Text style={[typography.bodyStrong, styles.buttonText]}>Verify & sign in</Text>}
            </Pressable>
            <Pressable onPress={() => { otpSent.current = false; setCode(""); setFormError(null); }} style={styles.backLink}>
              <Text style={[typography.caption, styles.backLinkText]}>← Use a different email</Text>
            </Pressable>
          </>
        )}

        {formError && <Text style={[typography.caption, styles.errorText]}>{formError}</Text>}
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
  codeInput: { fontFamily: typography.dataMd.fontFamily, fontSize: 22, letterSpacing: 6, textAlign: "center" },
  button: {
    backgroundColor: colors.terracotta[400],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.neutral.white },
  errorText: { color: colors.terracotta[300], marginTop: spacing.md },
  backLink: { alignItems: "center", marginTop: spacing.md },
  backLinkText: { color: colors.indigo[300], textDecorationLine: "underline" },
});
