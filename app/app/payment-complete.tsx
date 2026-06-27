import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";

/**
 * Where OPay's hosted Cashier page redirects the browser after the user pays
 * or cancels (see api/opay/create-payment.ts returnUrl/cancelUrl). The actual
 * mint() call happens server-side via api/opay/callback.ts, independently of
 * this page — this screen is just a human-readable confirmation.
 */
export default function PaymentCompleteScreen() {
  const router = useRouter();
  const { cancelled } = useLocalSearchParams<{ cancelled?: string }>();
  const wasCancelled = cancelled === "true";

  return (
    <View style={styles.screen}>
      <Text style={[typography.display, styles.title]}>{wasCancelled ? "Payment cancelled" : "Thank you"}</Text>
      <Text style={[typography.body, styles.subtitle]}>
        {wasCancelled
          ? "No charge was made. You can return to the app and try again."
          : "Your payment is being confirmed. Your ENGY balance will update shortly once it's processed on-chain."}
      </Text>
      <Pressable style={styles.button} onPress={() => router.replace("/(tabs)/dashboard")}>
        <Text style={[typography.bodyStrong, styles.buttonText]}>Return to dashboard</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: spacing.xl },
  title: { color: colors.textPrimary, marginBottom: spacing.md },
  subtitle: { color: colors.textSecondary, marginBottom: spacing.xl },
  button: { backgroundColor: colors.indigo[700], borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  buttonText: { color: colors.neutral.white },
});
