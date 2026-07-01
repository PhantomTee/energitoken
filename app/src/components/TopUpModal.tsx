import React, { useState } from "react";
import { Modal, View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Platform, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

const BACKEND_URL = Platform.OS === "web" ? "" : process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app";
const NGN_PER_UNIT = 1000; // 1 unit = 1 kWh = 1000 Wh, WH_PER_NGN=1 on server → 1000 NGN per unit

type Props = {
  visible: boolean;
  onClose: () => void;
  walletAddress: string;
  onMinted?: () => void;
};

async function pollOrderStatus(reference: string, maxAttempts = 12): Promise<"minted" | "failed" | "timeout"> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(`${BACKEND_URL}/api/opay/status?reference=${reference}`);
      if (!res.ok) continue;
      const json = await res.json();
      if (json.status === "minted") return "minted";
      if (json.status === "failed") return "failed";
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
    if (amount < NGN_PER_UNIT) {
      setError(`Minimum is ₦${NGN_PER_UNIT} (= 1 unit / 1 kWh).`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/opay/create-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, amountNgn: amount }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to start payment");

      if (Platform.OS === "web") {
        Linking.openURL(json.cashierUrl);
        onClose();
      } else {
        setLoading(false);
        await WebBrowser.openBrowserAsync(json.cashierUrl);
        // Browser closed — start polling to see if mint happened
        setPolling(true);
        const result = await pollOrderStatus(json.reference);
        setPolling(false);
        if (result === "minted") {
          setSuccess(true);
          onMinted?.();
        } else if (result === "failed") {
          setError("Payment was not completed. No charge was made.");
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
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          {success ? (
            <>
              <Text style={[typography.h2, styles.title]}>Top-up confirmed!</Text>
              <Text style={[typography.body, styles.subtitle]}>
                Your ENGY balance has been updated. It may take a moment to reflect on the dashboard.
              </Text>
              <Pressable style={styles.button} onPress={handleClose}>
                <Text style={[typography.bodyStrong, styles.buttonText]}>Done</Text>
              </Pressable>
            </>
          ) : polling ? (
            <>
              <ActivityIndicator color={colors.indigo[400]} style={{ marginBottom: spacing.md }} />
              <Text style={[typography.h2, styles.title]}>Confirming payment…</Text>
              <Text style={[typography.body, styles.subtitle]}>
                Waiting for OPay to confirm your payment. This can take up to a minute.
              </Text>
            </>
          ) : (
            <>
              <Text style={[typography.h2, styles.title]}>Top up with OPay</Text>
              <Text style={[typography.body, styles.subtitle]}>
                ₦1,000 = 1 unit (1 kWh). You'll be redirected to OPay's secure checkout.
              </Text>
              <Text style={[typography.label, styles.fieldLabel]}>AMOUNT (NGN)</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.neutral[500]}
                value={amountNgn}
                onChangeText={setAmountNgn}
                keyboardType="numeric"
                editable={!loading}
              />
              {amountNgn.length > 0 && (
                <Text style={[typography.caption, styles.preview]}>
                  = {unitsPreview} unit{Number(unitsPreview) !== 1 ? "s" : ""} ({Number(amountNgn).toLocaleString()} Wh)
                </Text>
              )}
              {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}
              <View style={styles.actions}>
                <Pressable style={[styles.secondaryButton, { flex: 1 }]} onPress={handleClose} disabled={loading}>
                  <Text style={[typography.bodyStrong, styles.secondaryButtonText]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.button, { flex: 1 }]} onPress={handlePay} disabled={loading}>
                  {loading ? (
                    <ActivityIndicator color={colors.neutral.white} />
                  ) : (
                    <Text style={[typography.bodyStrong, styles.buttonText]}>Pay with OPay</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(8,7,15,0.7)", justifyContent: "center", padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  title: { color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { color: colors.textSecondary, marginBottom: spacing.md },
  fieldLabel: { color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.background,
    color: colors.textPrimary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 18,
    fontFamily: typography.dataMd.fontFamily,
    borderWidth: 1,
    borderColor: colors.border,
  },
  preview: { color: colors.indigo[300], marginTop: spacing.xs },
  errorText: { color: colors.danger, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  button: { backgroundColor: colors.indigo[500], borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  buttonText: { color: colors.neutral.white },
  secondaryButton: { borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  secondaryButtonText: { color: colors.textPrimary },
});
