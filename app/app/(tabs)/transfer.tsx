import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Modal } from "react-native";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { TxStatus, TxState } from "../../src/components/TxStatus";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";

const MOCK_BALANCE_WH = 9800;

/**
 * Mock-only for now (build Step 4). Recipient resolution (email -> wallet via
 * the /directory node) and the real ERC-20 transfer() call land in Steps 7-8.
 */
export default function TransferScreen() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();

  const amountWh = Number(amount);
  const isValidAmount = amountWh > 0 && amountWh <= MOCK_BALANCE_WH;
  const isValidRecipient = recipient.includes("@") || recipient.startsWith("0x");
  const canSubmit = isValidAmount && isValidRecipient;

  const handleSend = () => {
    setShowConfirm(false);
    setTxState("pending");
    setTimeout(() => {
      setTxState("confirmed");
      setTxHash("0x" + Math.random().toString(16).slice(2).padEnd(64, "0"));
    }, 1200);
  };

  const reset = () => {
    setRecipient("");
    setAmount("");
    setTxState("idle");
    setTxHash(undefined);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={[typography.h1, styles.title]}>Send credit</Text>
        <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
      </View>
      <Text style={[typography.body, styles.subtitle]}>
        Share surplus watt-hours with another household, by email or wallet address.
      </Text>

      <Text style={[typography.label, styles.fieldLabel]}>RECIPIENT</Text>
      <TextInput
        style={styles.input}
        placeholder="email@example.com or 0x..."
        placeholderTextColor={colors.neutral[500]}
        value={recipient}
        onChangeText={setRecipient}
        autoCapitalize="none"
        editable={txState === "idle"}
      />

      <Text style={[typography.label, styles.fieldLabel]}>AMOUNT (Wh)</Text>
      <TextInput
        style={styles.input}
        placeholder="0"
        placeholderTextColor={colors.neutral[500]}
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        editable={txState === "idle"}
      />
      <Text style={[typography.dataXs, styles.balanceHint]}>
        Available: {MOCK_BALANCE_WH.toLocaleString()} Wh
      </Text>
      {amount.length > 0 && !isValidAmount && (
        <Text style={[typography.caption, styles.errorHint]}>
          {amountWh <= 0 ? "Enter an amount greater than 0." : "Amount exceeds your available balance."}
        </Text>
      )}

      {txState === "idle" ? (
        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          disabled={!canSubmit}
          onPress={() => setShowConfirm(true)}
        >
          <Text style={[typography.bodyStrong, styles.buttonText]}>Review transfer</Text>
        </Pressable>
      ) : (
        <View style={styles.statusWrap}>
          <TxStatus state={txState} hash={txHash} />
          {txState === "confirmed" && (
            <Pressable style={styles.secondaryButton} onPress={reset}>
              <Text style={[typography.bodyStrong, styles.secondaryButtonText]}>Send another</Text>
            </Pressable>
          )}
        </View>
      )}

      <Modal visible={showConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={[typography.h2, styles.modalTitle]}>Confirm transfer</Text>
            <View style={styles.summaryRow}>
              <Text style={[typography.body, styles.summaryLabel]}>To</Text>
              <Text style={[typography.dataXs, styles.summaryValue]}>{recipient}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[typography.body, styles.summaryLabel]}>Amount</Text>
              <Text style={[typography.dataSm, styles.summaryValue]}>{amountWh.toLocaleString()} Wh</Text>
            </View>
            <View style={styles.modalActions}>
              <Pressable style={[styles.secondaryButton, { flex: 1 }]} onPress={() => setShowConfirm(false)}>
                <Text style={[typography.bodyStrong, styles.secondaryButtonText]}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.modalConfirm]} onPress={handleSend}>
                <Text style={[typography.bodyStrong, styles.buttonText]}>Confirm & send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { color: colors.textSecondary, marginBottom: spacing.lg },
  fieldLabel: { color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    fontFamily: typography.body.fontFamily,
    borderWidth: 1,
    borderColor: colors.border,
  },
  balanceHint: { color: colors.textSecondary, marginTop: spacing.xs },
  errorHint: { color: colors.danger, marginTop: spacing.xs },
  button: {
    backgroundColor: colors.indigo[500],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: colors.neutral.white },
  statusWrap: { marginTop: spacing.lg, gap: spacing.md },
  secondaryButton: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.textPrimary },
  modalOverlay: { flex: 1, backgroundColor: "rgba(8,7,15,0.7)", justifyContent: "center", padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  modalTitle: { color: colors.textPrimary, marginBottom: spacing.md },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.sm },
  summaryLabel: { color: colors.textSecondary },
  summaryValue: { color: colors.textPrimary },
  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  modalConfirm: { flex: 1, marginTop: 0 },
});
