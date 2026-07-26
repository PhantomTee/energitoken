import React, { useState } from "react";
import { Modal, View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Platform, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

const BACKEND_URL = Platform.OS === "web" ? "" : process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app";
const NGN_PER_UNIT = 1000; // 1 unit = 1 kWh = 1000 Wh, WH_PER_NGN=1 on server → 1000 NGN per unit
const MIN_TOP_UP_NGN = 100; // must match TARIFF.minNgn in app/api/payments/create.ts

type Props = {
  visible: boolean;
  onClose: () => void;
  walletAddress: string;
  onMinted?: () => void;
};

async function pollOrderStatus(
  reference: string,
  maxAttempts = 12
): Promise<"minted" | "failed" | "mint_failed" | "timeout"> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(`${BACKEND_URL}/api/payments/status?reference=${reference}`);
      if (!res.ok) continue;
      const json = await res.json();
      if (json.status === "minted") return "minted";
      if (json.status === "failed") return "failed";
      // Payment verified successful, but the on-chain mint itself failed --
      // a terminal state distinct from "still processing".
      if (json.status === "mint_failed") return "mint_failed";
    } catch {
      // network glitch — keep polling
    }
  }
  return "timeout";
}

export function TopUpModal({ visible, onClose, walletAddress, onMinted }: Props) {
  const [amountNgn, setAmountNgn] = useState("");
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const unitsPreview = amountNgn ? (Number(amountNgn) / NGN_PER_UNIT).toFixed(3) : "0";

  const handlePay = async () => {
    const amount = Number(amountNgn);
    if (!amount || amount <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (amount < MIN_TOP_UP_NGN) {
      setError(`Minimum top-up is ₦${MIN_TOP_UP_NGN}.`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/payments/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, amountNgn: amount }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to start payment");

      if (Platform.OS === "web") {
        Linking.openURL(json.checkoutUrl);
        onClose();
      } else {
        setLoading(false);
        await WebBrowser.openBrowserAsync(json.checkoutUrl);
        // Browser closed — start polling to see if mint happened
        setPolling(true);
        const result = await pollOrderStatus(json.reference);
        setPolling(false);
        if (result === "minted") {
          setSuccess(true);
          onMinted?.();
        } else if (result === "failed") {
          setError("Payment was not completed. No charge was made.");
        } else if (result === "mint_failed") {
          setError(
            "Your payment went through, but we hit a hiccup crediting your balance. This is on our side, not yours — it's being retried and should resolve shortly."
          );
        } else {
          // timeout — payment may still be processing
          setError("Payment is still being confirmed. Check your balance in a few minutes.");
        }
      }
      setAmountNgn("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSuccess(false);
    setError(null);
    setAmountNgn("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.backButton}>
            <Text style={styles.backArrow}>←</Text>
          </Pressable>
          <Text style={[typography.h2, styles.headerTitle]}>Top Up</Text>
          <View style={styles.backButton} />
        </View>

        <View style={styles.body}>
          {success ? (
            <View style={styles.centerBlock}>
              <Text style={[typography.h1, styles.resultTitle]}>Top-up confirmed!</Text>
              <Text style={[typography.body, styles.resultSubtitle]}>
                Your ENGY balance has been updated. It may take a moment to reflect on the dashboard.
              </Text>
              <Pressable style={styles.payButton} onPress={handleClose}>
                <Text style={[typography.bodyStrong, styles.payButtonText]}>Done</Text>
              </Pressable>
            </View>
          ) : polling ? (
            <View style={styles.centerBlock}>
              <ActivityIndicator color={colors.terracotta[400]} style={{ marginBottom: spacing.md }} />
              <Text style={[typography.h1, styles.resultTitle]}>Confirming payment…</Text>
              <Text style={[typography.body, styles.resultSubtitle]}>
                Waiting for your payment to be confirmed. This can take up to a minute.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.amountCard}>
                <Text style={[typography.label, styles.amountCardLabel]}>ENTER AMOUNT</Text>
                <View style={styles.amountRow}>
                  <Text style={styles.currencySymbol}>₦</Text>
                  <TextInput
                    style={styles.amountInput}
                    placeholder="0"
                    placeholderTextColor={colors.neutral[500]}
                    value={amountNgn}
                    onChangeText={setAmountNgn}
                    keyboardType="numeric"
                    editable={!loading}
                  />
                </View>
                {amountNgn.length > 0 && (
                  <View style={styles.conversionPill}>
                    <Text style={[typography.dataSm, styles.conversionText]}>
                      ⇄ ≈ {unitsPreview} unit{Number(unitsPreview) !== 1 ? "s" : ""} ENGY
                    </Text>
                  </View>
                )}
              </View>

              <Text style={[typography.caption, styles.minNote]}>
                ₦1,000 = 1 unit (1 kWh) · minimum ₦{MIN_TOP_UP_NGN}
              </Text>
              {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}

              <Pressable style={[styles.payButton, loading && styles.payButtonDisabled]} onPress={handlePay} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color={colors.neutral.white} />
                ) : (
                  <Text style={[typography.bodyStrong, styles.payButtonText]}>🏦  Pay with bank</Text>
                )}
              </Pressable>

              <Pressable onPress={handleClose} disabled={loading} style={styles.cancelLink}>
                <Text style={[typography.caption, styles.cancelLinkText]}>Cancel</Text>
              </Pressable>

              <Text style={[typography.dataXs, styles.poweredBy]}>🛡 POWERED BY FLUTTERWAVE</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.indigo[900] },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  backButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  backArrow: { color: colors.neutral.white, fontSize: 20 },
  headerTitle: { color: colors.neutral.white },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  centerBlock: { alignItems: "center", gap: spacing.md },
  resultTitle: { color: colors.neutral.white, textAlign: "center" },
  resultSubtitle: { color: colors.indigo[100], textAlign: "center", opacity: 0.85 },
  amountCard: {
    backgroundColor: colors.indigo[700],
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },
  amountCardLabel: { color: colors.indigo[100], opacity: 0.8 },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    width: "100%",
  },
  currencySymbol: { color: colors.textSecondary, fontSize: 22, marginRight: spacing.sm },
  amountInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 32,
    fontFamily: typography.dataMd.fontFamily,
    paddingVertical: spacing.md,
  },
  conversionPill: {
    backgroundColor: "rgba(194,100,58,0.2)",
    borderWidth: 1,
    borderColor: colors.terracotta[400],
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  conversionText: { color: colors.terracotta[300] },
  minNote: { color: colors.indigo[100], opacity: 0.7, textAlign: "center" },
  errorText: { color: colors.terracotta[300], textAlign: "center" },
  payButton: {
    backgroundColor: colors.terracotta[400],
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  payButtonDisabled: { opacity: 0.6 },
  payButtonText: { color: colors.neutral.white },
  cancelLink: { alignItems: "center", padding: spacing.sm },
  cancelLinkText: { color: colors.indigo[100] },
  poweredBy: { color: colors.indigo[300], textAlign: "center", opacity: 0.7, letterSpacing: 0.5 },
});
