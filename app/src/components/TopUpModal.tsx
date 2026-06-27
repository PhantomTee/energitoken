import React, { useState } from "react";
import { Modal, View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Platform, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

/**
 * On web the app and the /api functions share an origin, so a relative path
 * works. On native (Expo Go / dev client) there's no origin to be relative
 * to, so an absolute deployed URL is required.
 */
const BACKEND_URL = Platform.OS === "web" ? "" : process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

type Props = {
  visible: boolean;
  onClose: () => void;
  walletAddress: string;
};

export function TopUpModal({ visible, onClose, walletAddress }: Props) {
  const [amountNgn, setAmountNgn] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    const amount = Number(amountNgn);
    if (!amount || amount <= 0) {
      setError("Enter an amount greater than 0.");
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
      } else {
        await WebBrowser.openBrowserAsync(json.cashierUrl);
      }
      onClose();
      setAmountNgn("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={[typography.h2, styles.title]}>Top up with OPay</Text>
          <Text style={[typography.body, styles.subtitle]}>
            1 NGN = 1 Wh. You'll be redirected to OPay's secure checkout to pay.
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
          {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}
          <View style={styles.actions}>
            <Pressable style={[styles.secondaryButton, { flex: 1 }]} onPress={onClose} disabled={loading}>
              <Text style={[typography.bodyStrong, styles.secondaryButtonText]}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.button, { flex: 1 }]} onPress={handlePay} disabled={loading}>
              {loading ? <ActivityIndicator color={colors.neutral.white} /> : (
                <Text style={[typography.bodyStrong, styles.buttonText]}>Pay with OPay</Text>
              )}
            </Pressable>
          </View>
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
  errorText: { color: colors.danger, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  button: { backgroundColor: colors.indigo[500], borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  buttonText: { color: colors.neutral.white },
  secondaryButton: { borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  secondaryButtonText: { color: colors.textPrimary },
});
