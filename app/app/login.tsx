import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";
import { AdinkraAccent } from "../src/theme/motifs/AdinkraAccent";

/**
 * Static login UI for now — Privy email magic-link wiring lands in build Step 5.
 * The fake delay mimics what a real magic-link round trip will feel like, so
 * the screen transitions are already correct.
 */
export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const handleContinue = () => {
    if (!email.includes("@")) return;
    setSending(true);
    setTimeout(() => {
      setSending(false);
      router.replace("/(tabs)/dashboard");
    }, 900);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.accentTopRight}>
        <AdinkraAccent size={96} color={colors.terracotta[500]} />
      </View>

      <View style={styles.content}>
        <Text style={[typography.label, styles.brandLabel]}>ENERGITOKEN</Text>
        <Text style={[typography.display, styles.title]}>Power, budgeted{"\n"}and shared.</Text>
        <Text style={[typography.body, styles.subtitle]}>
          Sign in with your email to see your household's energy budget and credit balance.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor={colors.neutral[500]}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!sending}
        />

        <Pressable
          style={[styles.button, (!email.includes("@") || sending) && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={!email.includes("@") || sending}
        >
          {sending ? (
            <ActivityIndicator color={colors.neutral.white} />
          ) : (
            <Text style={[typography.bodyStrong, styles.buttonText]}>Continue with email</Text>
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
});
