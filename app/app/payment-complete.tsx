import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";
import { AdinkraAccent } from "../src/theme/motifs/AdinkraAccent";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app";

type OrderStatus = "polling" | "minted" | "failed" | "mint_failed" | "cancelled" | "timeout";

/**
 * Where the hosted checkout page redirects the browser after the user pays,
 * cancels, or the attempt fails -- all three land here with the same
 * redirect_url, differentiated by a `status` query param (successful |
 * cancelled | failed), plus `tx_ref`. That param is only a UX hint for which
 * screen to show first; the actual state always comes from polling
 * /api/payments/status, which reflects Firebase order state set only by the
 * verified webhook (api/payments/callback.ts) -- never trusted from the URL.
 */
export default function PaymentCompleteScreen() {
  const router = useRouter();
  const { status: redirectStatus, tx_ref } = useLocalSearchParams<{ status?: string; tx_ref?: string }>();
  const [status, setStatus] = useState<OrderStatus>(redirectStatus === "cancelled" ? "cancelled" : "polling");

  useEffect(() => {
    if (status !== "polling" || !tx_ref) {
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
        const res = await fetch(`${BACKEND_URL}/api/payments/status?reference=${tx_ref}`);
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            if (json.status === "minted") { setStatus("minted"); return; }
            if (json.status === "failed") { setStatus("failed"); return; }
            // Payment was verified successful by the provider, but the
            // on-chain mint step itself failed (e.g. an RPC hiccup) --
            // distinct from "still processing" so the user isn't left
            // waiting on a state that's already terminal.
            if (json.status === "mint_failed") { setStatus("mint_failed"); return; }
          }
        }
      } catch {
        // network glitch
      }
      if (!cancelled) setTimeout(poll, 5000);
    };

    poll();
    return () => { cancelled = true; };
  }, [tx_ref, status]);

  const content: Record<OrderStatus, { title: string; body: string; titleColor: string }> = {
    polling: {
      title: "Confirming payment…",
      body: "We're waiting for your payment to be confirmed. This usually takes under a minute.",
      titleColor: colors.textPrimary,
    },
    minted: {
      title: "Top-up complete!",
      body: "Your ENGY balance has been updated. It may take a moment to show on the dashboard.",
      titleColor: colors.success,
    },
    failed: {
      title: "Payment not completed",
      body: "Your payment could not be confirmed. No charge was made. You can try again from the dashboard.",
      titleColor: colors.danger,
    },
    mint_failed: {
      title: "Payment received — crediting your balance",
      body: "Your payment went through, but we hit a hiccup adding the credit to your balance. This is on our side, not yours — it's being retried automatically and should resolve shortly. If it doesn't, contact support with this reference.",
      titleColor: colors.warning,
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
