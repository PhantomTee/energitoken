import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";
import { AdinkraAccent } from "../src/theme/motifs/AdinkraAccent";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app";

type OrderStatus = "polling" | "minted" | "failed" | "cancelled" | "timeout";

/**
 * Where OPay's hosted Cashier page redirects the browser after the user pays
 * or cancels. Polls our /api/opay/status endpoint to confirm the mint.
 * The actual mint() call happens server-side via api/opay/callback.ts.
 */
export default function PaymentCompleteScreen() {
  const router = useRouter();
  const { cancelled, reference } = useLocalSearchParams<{ cancelled?: string; reference?: string }>();
  const [status, setStatus] = useState<OrderStatus>(cancelled === "true" ? "cancelled" : "polling");

  useEffect(() => {
    if (status !== "polling" || !reference) {
      if (status === "polling") setStatus("timeout");
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 12;

    const poll = async () => {
      if (cancelled || attempts >= maxAttempts) {
        if (!cancelled) setStatus("timeout");
        return;
      }
      attempts++;
      try {
        const res = await fetch(`${BACKEND_URL}/api/opay/status?reference=${reference}`);
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            if (json.status === "minted") { setStatus("minted"); return; }
            if (json.status === "failed") { setStatus("failed"); return; }
          }
        }
      } catch {
        // network glitch
      }
      if (!cancelled) setTimeout(poll, 5000);
    };

    poll();
    return () => { cancelled = true; };
  }, [reference, status]);

  const content: Record<OrderStatus, { title: string; body: string; titleColor: string }> = {
    polling: {
      title: "Confirming payment…",
      body: "We're waiting for OPay to confirm your payment. This usually takes under a minute.",
      titleColor: colors.textPrimary,
    },
    minted: {
      title: "Top-up complete!",
      body: "Your ENGY balance has been updated. It may take a moment to show on the dashboard.",
      titleColor: colors.success,
    },
    failed: {
      title: "Payment not completed",
      body: "Your payment was not confirmed by OPay. No charge was made. You can try again from the dashboard.",
      titleColor: colors.danger,
    },
    cancelled: {
      title: "Payment cancelled",
      body: "No charge was made. You can return to the app and try again.",
      titleColor: colors.textSecondary,
    },
    timeout: {
      title: "Still processing…",
      body: "Your payment is taking longer than expected. If you completed payment, your balance will update shortly. Check back in a few minutes.",
      titleColor: colors.textPrimary,
    },
  };

  const { title, body, titleColor } = content[status];

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <AdinkraAccent size={48} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
        {status === "polling" ? (
          <ActivityIndicator color={colors.indigo[400]} style={styles.spinner} />
        ) : null}
        <Text style={[typography.display, styles.title, { color: titleColor }]}>{title}</Text>
        <Text style={[typography.body, styles.subtitle]}>{body}</Text>
        {status !== "polling" && (
          <Pressable style={styles.button} onPress={() => router.replace("/(tabs)/dashboard")}>
            <Text style={[typography.bodyStrong, styles.buttonText]}>Return to dashboard</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl, gap: spacing.md },
  spinner: { marginTop: spacing.sm },
  title: { textAlign: "center" },
  subtitle: { color: colors.textSecondary, textAlign: "center", marginBottom: spacing.md },
  button: { backgroundColor: colors.indigo[500], borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, alignItems: "center" },
  buttonText: { color: colors.neutral.white },
});
