import React, { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Modal } from "react-native";
import { useFocusEffect } from "expo-router";
import { isAddress } from "ethers";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { TxStatus, TxState } from "../../src/components/TxStatus";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { useWallet } from "../../src/hooks/useWallet";
import { getEngyBalance, getWritableContract } from "../../src/services/contract";

/**
 * Email -> wallet resolution (the /directory lookup) lands in build Step 8.
 * For now, recipients must be entered as a raw wallet address — the input
 * still accepts an email-looking string so the UI doesn't have to change
 * shape later, but submission is blocked with an explicit message rather
 * than silently failing.
 */
export default function TransferScreen() {
  const { walletAddress, getSigner } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  const [balanceWh, setBalanceWh] = useState<bigint | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const balance = await getEngyBalance(walletAddress);
      setBalanceWh(balance);
    } catch {
      // leave balance as-is; the UI shows a loading state until a read succeeds
    }
  }, [walletAddress]);

  useFocusEffect(
    useCallback(() => {
      refreshBalance();
    }, [refreshBalance])
  );

  const amountWh = Number(amount);
  const isEmailEntry = recipient.includes("@");
  const isValidRecipient = isAddress(recipient);
  const isValidAmount = balanceWh !== null && amountWh > 0 && BigInt(Math.floor(amountWh)) <= balanceWh;
  const canSubmit = isValidAmount && isValidRecipient;

  const handleSend = async () => {
    setShowConfirm(false);
    setTxState("pending");
    setTxError(undefined);
    try {
      const signer = await getSigner();
      const contract = getWritableContract(signer);
      const tx = await contract.transfer(recipient, BigInt(Math.floor(amountWh)));
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("confirmed");
      await refreshBalance();
    } catch (err) {
      setTxState("failed");
      setTxError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const reset = () => {
    setRecipient("");
    setAmount("");
    setTxState("idle");
    setTxHash(undefined);
    setTxError(undefined);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={[typography.h1, styles.title]}>Send credit</Text>
        <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
      </View>
      <Text style={[typography.body, styles.subtitle]}>
        Share surplus watt-hours with another household's wallet address.
      </Text>

      <Text style={[typography.label, styles.fieldLabel]}>RECIPIENT WALLET ADDRESS</Text>
      <TextInput
        style={styles.input}
        placeholder="0x..."
        placeholderTextColor={colors.neutral[500]}
        value={recipient}
        onChangeText={setRecipient}
        autoCapitalize="none"
        editable={txState === "idle"}
      />
      {isEmailEntry && (
        <Text style={[typography.caption, styles.errorHint]}>
          Sending by email isn't wired up yet — enter the recipient's wallet address (0x...).
        </Text>
      )}
      {recipient.length > 0 && !isEmailEntry && !isValidRecipient && (
        <Text style={[typography.caption, styles.errorHint]}>That doesn't look like a valid wallet address.</Text>
      )}

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
        Available: {balanceWh === null ? "loading…" : `${balanceWh.toLocaleString()} Wh`}
      </Text>
      {amount.length > 0 && balanceWh !== null && !isValidAmount && (
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
          <TxStatus state={txState} hash={txHash} error={txError} />
          {(txState === "confirmed" || txState === "failed") && (
            <Pressable style={styles.secondaryButton} onPress={reset}>
              <Text style={[typography.bodyStrong, styles.secondaryButtonText]}>
                {txState === "confirmed" ? "Send another" : "Try again"}
              </Text>
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
