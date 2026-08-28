import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { isAddress } from "ethers";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { TxStatus, TxState } from "../../src/components/TxStatus";
import { MobileTopBar } from "../../src/components/MobileTopBar";
import { useWallet } from "../../src/hooks/useWallet";
import {
  getEngyBalance,
  getSpendableBalance,
  sendTransferTx,
  runTransferPreflight,
  checkNetworkAndGas,
} from "../../src/services/contract";
import { resolveEmailToAddress } from "../../src/services/directory";
import { QRScanner } from "../../src/components/QRScanner";
import { useTransactionHistory } from "../../src/hooks/useTransactionHistory";
import { TxDirection } from "../../src/services/contractEvents";
import { exportTransactionsCsv } from "../../src/services/exportReport";
import { useIsDesktopWeb } from "../../src/hooks/useIsDesktopWeb";
import { displayNameFromEmail } from "../../src/services/displayName";
import { useMeterData } from "../../src/hooks/useMeterData";
import { getUnbudgetedWh } from "../../src/services/units";

const TX_DIRECTION_META: Record<TxDirection, string> = {
  mint: "Purchased",
  "transfer-in": "Received",
  "transfer-out": "Sent",
  burn: "Consumed",
};

function formatTxDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Parses the amount field into a whole-Wh BigInt, or null if the input
 * isn't a genuine positive whole number worth transferring. Never throws:
 * `BigInt(Math.floor(Number(input)))` used to be called directly on
 * whatever the user typed or pasted, and `BigInt()` throws a RangeError on
 * a non-finite number -- Number("1e400") is Infinity, which is > 0 and so
 * passed every earlier check, then crashed the render the moment it
 * reached a raw BigInt() call. Rejects (rather than silently flooring)
 * decimal input too, so "1.9" can't display as "1.9 ENGY" while actually
 * sending 1 -- the user should retype a whole number, not have it guessed.
 */
function parseAmountWh(input: string): bigint | null {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n) || !Number.isSafeInteger(n)) return null;
  return BigInt(n);
}

/**
 * Recipients can be a raw wallet address or an email -- emails are resolved
 * against the /directory node (written by the Dashboard after login). If an
 * email hasn't logged in yet there's nothing to resolve to, so that's
 * surfaced explicitly rather than silently blocking the form.
 */
function PreflightRow({
  label,
  state,
  loading,
}: {
  label: string;
  state: boolean | null;
  loading?: boolean;
}) {
  const icon = loading ? "…" : state === true ? "✓" : state === false ? "✗" : "—";
  const color = loading ? colors.textSecondary : state === true ? colors.success : state === false ? colors.danger : colors.textSecondary;
  return (
    <View style={styles.preflightRow}>
      <Text style={[typography.bodyStrong, { color }]}>{icon}</Text>
      <Text style={[typography.caption, styles.preflightLabel]}>{label}</Text>
    </View>
  );
}

/**
 * The client-side spendable-balance check (isValidAmount / runTransferPreflight)
 * covers the common case, but the on-chain figure can move between the quote
 * and the send (e.g. a burn/pendingBurn update lands in between) -- the
 * contract's own SpendableBalanceExceeded revert is the real backstop, so
 * surface it with the same friendly wording rather than a raw ethers error.
 */
function describeTransferError(err: unknown): string {
  const anyErr = err as { revert?: { name?: string }; shortMessage?: string; reason?: string } | undefined;
  const looksLikeSpendableRevert =
    anyErr?.revert?.name === "SpendableBalanceExceeded" ||
    (anyErr?.shortMessage ?? anyErr?.reason ?? "").includes("SpendableBalanceExceeded");

  if (looksLikeSpendableRevert) {
    return "That amount exceeds your spendable balance — some of your on-chain balance is energy you've already used that hasn't settled yet. Try a smaller amount.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

type RecipientMode = "email" | "address" | "qr";

const RECIPIENT_TABS: { key: RecipientMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = Platform.OS === "web"
  ? [
      { key: "email", label: "Email", icon: "mail-outline" },
      { key: "address", label: "Wallet Address", icon: "card-outline" },
    ]
  : [
      { key: "email", label: "Email", icon: "mail-outline" },
      { key: "address", label: "Wallet Address", icon: "card-outline" },
      { key: "qr", label: "QR Code", icon: "qr-code-outline" },
    ];

export default function TransferScreen() {
  const isDesktop = useIsDesktopWeb();
  const { walletAddress, getSigner } = useWallet();
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("email");
  const [recipient, setRecipient] = useState("");
  const [scannedAddress, setScannedAddress] = useState<string | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  const [balanceWh, setBalanceWh] = useState<bigint | null>(null);
  const [spendableWh, setSpendableWh] = useState<bigint | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [networkOk, setNetworkOk] = useState<boolean | null>(null);
  const [gasOk, setGasOk] = useState<boolean | null>(null);
  const [checkingChain, setCheckingChain] = useState(false);

  const { transactions: historyTransactions, refresh: refreshHistory } = useTransactionHistory(
    isDesktop ? walletAddress : null
  );
  const { reading } = useMeterData(walletAddress, getSigner);

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const [balance, spendable] = await Promise.all([
        getEngyBalance(walletAddress),
        getSpendableBalance(walletAddress),
      ]);
      setBalanceWh(balance);
      setSpendableWh(spendable);
    } catch {
      // leave balances as-is; the UI shows a loading state until a read succeeds
    }
  }, [walletAddress]);

  // What's actually free to send: spendable balance minus today's
  // remaining budget allowance (see getUnbudgetedWh). No budget set at all
  // reserves nothing, so this equals spendableWh for most households.
  const unbudgetedWh =
    spendableWh !== null
      ? getUnbudgetedWh(spendableWh, reading?.budgetWh ?? null, reading?.energyWh ?? null)
      : null;

  useFocusEffect(
    useCallback(() => {
      refreshBalance();
    }, [refreshBalance])
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshBalance();
    setRefreshing(false);
  }, [refreshBalance]);

  const isEmailEntry = recipientMode === "email";

  // Debounced email -> wallet lookup against the /directory node.
  useEffect(() => {
    setResolvedAddress(null);
    setResolveError(null);
    if (!isEmailEntry || recipient.trim().length < 5 || !walletAddress) return;

    setResolving(true);
    const timer = setTimeout(() => {
      resolveEmailToAddress(recipient, walletAddress, getSigner)
        .then((address) => {
          if (address) {
            setResolvedAddress(address);
          } else {
            setResolveError("No wallet found for that email yet -- they need to log into EnergiToken at least once.");
          }
        })
        .catch(() => setResolveError("Couldn't look up that email right now."))
        .finally(() => setResolving(false));
    }, 500);

    return () => clearTimeout(timer);
  }, [recipient, isEmailEntry, walletAddress]);

  const effectiveAddress =
    recipientMode === "email"
      ? resolvedAddress
      : recipientMode === "qr"
        ? scannedAddress
        : isAddress(recipient)
          ? recipient
          : null;
  const amountWh = Number(amount);
  const parsedAmountWh = parseAmountWh(amount);
  const isValidRecipient = effectiveAddress !== null;
  const isValidAmount = unbudgetedWh !== null && parsedAmountWh !== null && parsedAmountWh <= unbudgetedWh;
  const canSubmit = isValidAmount && isValidRecipient && !resolving && networkOk === true && gasOk === true;

  // Live network + gas check, once recipient and amount are otherwise valid --
  // powers the pre-flight checklist below. Debounced so it doesn't re-fire on
  // every keystroke while the amount field is still being typed.
  useEffect(() => {
    if (!isValidRecipient || !isValidAmount) {
      setNetworkOk(null);
      setGasOk(null);
      return;
    }
    let cancelled = false;
    setCheckingChain(true);
    const timer = setTimeout(() => {
      getSigner()
        .then((signer) => checkNetworkAndGas(signer))
        .then(({ networkOk: n, gasOk: g }) => {
          if (cancelled) return;
          setNetworkOk(n);
          setGasOk(g);
        })
        .catch(() => {
          if (cancelled) return;
          setNetworkOk(false);
          setGasOk(false);
        })
        .finally(() => {
          if (!cancelled) setCheckingChain(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isValidRecipient, isValidAmount, getSigner]);

  const handleSend = async () => {
    if (!effectiveAddress || parsedAmountWh === null) return;
    setShowConfirm(false);
    setTxHash(undefined);
    setTxError(undefined);
    setTxState("signing");
    try {
      const signer = await getSigner();

      // Checked separately from runTransferPreflight below: this is our own
      // app-level policy (today's remaining budget stays reserved), not the
      // contract's hard on-chain limit, so it gets its own accurate message
      // instead of borrowing the spendable-balance one.
      if (unbudgetedWh !== null && parsedAmountWh > unbudgetedWh) {
        setTxState("failed");
        setTxError("That amount reaches into today's remaining budget allowance. Lower the amount, or free it up by reducing your budget first.");
        return;
      }

      const preflightError = await runTransferPreflight(signer, amountWh, spendableWh ?? 0n);
      if (preflightError) {
        setTxState("failed");
        setTxError(preflightError);
        return;
      }

      const tx = await sendTransferTx(signer, effectiveAddress, parsedAmountWh);
      setTxHash(tx.hash);
      setTxState("submitted");
      await tx.wait();
      setTxState("confirmed");
      await refreshBalance();
      if (isDesktop) refreshHistory();
    } catch (err) {
      setTxState("failed");
      setTxError(describeTransferError(err));
    }
  };

  const reset = () => {
    setRecipientMode("email");
    setRecipient("");
    setScannedAddress(null);
    setScanError(null);
    setAmount("");
    setTxState("idle");
    setTxHash(undefined);
    setTxError(undefined);
    setResolvedAddress(null);
    setResolveError(null);
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.indigo[400]}
          colors={[colors.indigo[400]]}
        />
      }
    >
      {!isDesktop && (
        <>
          <MobileTopBar />
          <Text style={[typography.h1, styles.title, styles.titleCentered]}>Send Energy</Text>
        </>
      )}
      <View style={styles.availablePill}>
        <Text style={[typography.caption, styles.availablePillLabel]}>Available to send:</Text>
        <Text style={[typography.dataSm, styles.availablePillValue]}>
          {unbudgetedWh === null ? "···" : `${unbudgetedWh.toLocaleString()} ENGY`}
        </Text>
      </View>
      {spendableWh !== null && unbudgetedWh !== null && spendableWh !== unbudgetedWh && (
        <Text style={[typography.caption, styles.spendableHint]}>
          {spendableWh.toLocaleString()} ENGY spendable — the rest is today's remaining budget
          allowance, set aside so sending it wouldn't leave you short before your next top-up.
        </Text>
      )}
      {balanceWh !== null && spendableWh !== null && balanceWh !== spendableWh && (
        <Text style={[typography.caption, styles.spendableHint]}>
          On-chain balance is {balanceWh.toLocaleString()} ENGY — the difference is energy you've
          already used that hasn't settled on-chain yet, so it can't be sent.
        </Text>
      )}

      <View style={isDesktop ? styles.desktopRow : undefined}>
      <View style={isDesktop ? styles.desktopFormCol : undefined}>

      <Text style={[typography.label, styles.fieldLabel]}>RECIPIENT</Text>
      <View style={styles.tabRow}>
        {RECIPIENT_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tabChip, recipientMode === tab.key && styles.tabChipActive]}
            disabled={txState !== "idle"}
            onPress={() => {
              setRecipientMode(tab.key);
              setRecipient("");
              setResolvedAddress(null);
              setResolveError(null);
              setScannedAddress(null);
              setScanError(null);
            }}
          >
            <Ionicons
              name={tab.icon}
              size={14}
              color={recipientMode === tab.key ? colors.neutral.white : colors.textSecondary}
              style={styles.tabIcon}
            />
            <Text style={[typography.caption, recipientMode === tab.key ? styles.tabTextActive : styles.tabText]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {recipientMode === "qr" ? (
        <View style={styles.qrPlaceholder}>
          {scannedAddress ? (
            <>
              <Text style={[typography.caption, styles.resolveSuccess]}>
                Scanned {scannedAddress.slice(0, 6)}…{scannedAddress.slice(-4)}
              </Text>
              <Pressable style={styles.secondaryButton} onPress={() => setScannerVisible(true)}>
                <Text style={[typography.bodyStrong, styles.secondaryButtonText]}>Scan a different code</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[typography.body, styles.qrPlaceholderText]}>
                Scan the recipient's wallet QR code (shown on their Settings screen).
              </Text>
              <Pressable style={styles.button} onPress={() => setScannerVisible(true)} disabled={txState !== "idle"}>
                <Text style={[typography.bodyStrong, styles.buttonText]}>Open camera</Text>
              </Pressable>
            </>
          )}
          {scanError && <Text style={[typography.caption, styles.errorHint]}>{scanError}</Text>}
        </View>
      ) : (
        <>
          <View style={styles.inputRow}>
            <Ionicons
              name={isEmailEntry ? "search-outline" : "wallet-outline"}
              size={16}
              color={colors.textSecondary}
              style={styles.inputRowIcon}
            />
            <TextInput
              style={styles.inputRowField}
              placeholder={recipientMode === "email" ? "email@example.com" : "0x..."}
              placeholderTextColor={colors.neutral[500]}
              value={recipient}
              onChangeText={setRecipient}
              autoCapitalize="none"
              keyboardType={recipientMode === "email" ? "email-address" : "default"}
              editable={txState === "idle"}
            />
          </View>
          {isEmailEntry && resolving && (
            <View style={styles.resolveRow}>
              <ActivityIndicator size="small" color={colors.indigo[400]} />
              <Text style={[typography.caption, styles.resolveText]}>Looking up that email…</Text>
            </View>
          )}
          {isEmailEntry && !resolving && resolvedAddress && (
            <View style={styles.contactCard}>
              <View style={styles.contactAvatar}>
                <Text style={styles.contactAvatarText}>{displayNameFromEmail(recipient).charAt(0)}</Text>
              </View>
              <View style={styles.contactBody}>
                <Text style={[typography.bodyStrong, styles.contactName]}>{displayNameFromEmail(recipient)}</Text>
                <Text style={[typography.caption, styles.contactSending]}>Sending to: {recipient}</Text>
              </View>
              <Pressable onPress={() => setRecipient("")} hitSlop={8} disabled={txState !== "idle"}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}
          {isEmailEntry && !resolving && resolveError && (
            <Text style={[typography.caption, styles.errorHint]}>{resolveError}</Text>
          )}
          {recipient.length > 0 && !isEmailEntry && !isValidRecipient && (
            <Text style={[typography.caption, styles.errorHint]}>That doesn't look like a valid wallet address.</Text>
          )}
        </>
      )}

      <View style={styles.amountLabelRow}>
        <Text style={[typography.label, styles.fieldLabel, { marginTop: 0 }]}>AMOUNT (ENGY)</Text>
        {unbudgetedWh !== null && (
          <Pressable onPress={() => setAmount(String(unbudgetedWh))} disabled={txState !== "idle"}>
            <Text style={[typography.dataXs, styles.sendMaxLink]}>Send Max</Text>
          </Pressable>
        )}
      </View>
      <TextInput
        style={styles.input}
        placeholder="0"
        placeholderTextColor={colors.neutral[500]}
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        editable={txState === "idle"}
      />
      {amount.length > 0 && unbudgetedWh !== null && !isValidAmount && (
        <Text style={[typography.caption, styles.errorHint]}>
          {parsedAmountWh === null
            ? "Enter a whole number of Wh greater than 0."
            : spendableWh !== null && parsedAmountWh > spendableWh
              ? "Amount exceeds your spendable balance."
              : "That reaches into today's remaining budget allowance."}
        </Text>
      )}

      {txState === "idle" && (recipient.length > 0 || amount.length > 0) && (
        <View style={styles.preflightCard}>
          <Text style={[typography.label, styles.preflightTitle]}>Before you send</Text>
          <PreflightRow label="Recipient wallet found" state={isValidRecipient} />
          <PreflightRow label="You have enough credit" state={isValidAmount} />
          <PreflightRow
            label="Connected to Polygon Amoy"
            state={networkOk}
            loading={checkingChain && networkOk === null}
          />
          <PreflightRow
            label="Sufficient gas"
            state={gasOk}
            loading={checkingChain && gasOk === null}
          />
        </View>
      )}

      {txState === "idle" ? (
        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          disabled={!canSubmit}
          onPress={() => setShowConfirm(true)}
        >
          <Text style={[typography.bodyStrong, styles.buttonText]}>Send Energy  →</Text>
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

      </View>

      {isDesktop && (
        <View style={styles.historyCol}>
          <View style={styles.historyCard}>
            <View style={styles.historyCardHeader}>
              <View>
                <Text style={[typography.h2, styles.cardTitle]}>Transfer History</Text>
                <Text style={[typography.caption, styles.historyCardSubtitle]}>
                  Review your recent energy token movements.
                </Text>
              </View>
              {historyTransactions.length > 0 && walletAddress && (
                <Pressable
                  style={styles.exportButton}
                  onPress={() => exportTransactionsCsv(historyTransactions, walletAddress)}
                >
                  <Ionicons name="download-outline" size={14} color={colors.indigo[500]} />
                  <Text style={[typography.dataXs, styles.exportButtonText]}>Export CSV</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.historyTableHeader}>
              <Text style={[typography.label, styles.thDate]}>DATE</Text>
              <Text style={[typography.label, styles.thType]}>TYPE</Text>
              <Text style={[typography.label, styles.thCounterparty]}>RECIPIENT / SENDER</Text>
              <Text style={[typography.label, styles.thAmount]}>AMOUNT</Text>
              <Text style={[typography.label, styles.thStatus]}>STATUS</Text>
            </View>
            {historyTransactions.length === 0 ? (
              <Text style={[typography.caption, styles.statusText]}>No transactions yet for this wallet.</Text>
            ) : (
              historyTransactions.slice(0, 20).map((tx) => (
                <View key={tx.hash} style={styles.historyTableRow}>
                  <Text style={[typography.caption, styles.thDate, styles.historyCellText]}>
                    {formatTxDate(tx.timestamp)}
                  </Text>
                  <Text style={[typography.caption, styles.thType, styles.historyCellText]}>
                    {TX_DIRECTION_META[tx.direction]}
                  </Text>
                  <Text style={[typography.dataXs, styles.thCounterparty, styles.historyCellText]} numberOfLines={1}>
                    {tx.counterparty}
                  </Text>
                  <Text
                    style={[
                      typography.dataSm,
                      styles.thAmount,
                      { color: tx.direction === "transfer-out" || tx.direction === "burn" ? colors.textPrimary : colors.success },
                    ]}
                  >
                    {tx.direction === "transfer-out" || tx.direction === "burn" ? "-" : "+"}
                    {tx.amountWh.toLocaleString()} Wh
                  </Text>
                  <View style={styles.thStatus}>
                    <View style={styles.historyStatusPill}>
                      <Text style={[typography.dataXs, styles.historyStatusPillText]}>Confirmed</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      )}

      </View>

      <Modal visible={showConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={[typography.h2, styles.modalTitle]}>Confirm transfer</Text>
            <View style={styles.summaryRow}>
              <Text style={[typography.body, styles.summaryLabel]}>To</Text>
              <Text style={[typography.dataXs, styles.summaryValue]}>
                {isEmailEntry ? recipient : effectiveAddress}
              </Text>
            </View>
            {isEmailEntry && effectiveAddress && (
              <View style={styles.summaryRow}>
                <Text style={[typography.body, styles.summaryLabel]}>Wallet</Text>
                <Text style={[typography.dataXs, styles.summaryValue]}>
                  {effectiveAddress.slice(0, 6)}…{effectiveAddress.slice(-4)}
                </Text>
              </View>
            )}
            <View style={styles.summaryRow}>
              <Text style={[typography.body, styles.summaryLabel]}>Amount</Text>
              <Text style={[typography.dataSm, styles.summaryValue]}>{amountWh.toLocaleString()} ENGY</Text>
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

      <QRScanner
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        title="Scan the recipient's wallet QR code"
        onScanned={(data) => {
          setScannerVisible(false);
          if (isAddress(data)) {
            setScannedAddress(data);
            setScanError(null);
          } else {
            setScannedAddress(null);
            setScanError("That QR code doesn't contain a valid wallet address.");
          }
        }}
      />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, width: "100%", alignSelf: "center" },
  contentDesktop: { padding: spacing.xxl, paddingBottom: spacing.xxl, maxWidth: 1100 },
  title: { color: colors.textPrimary, marginBottom: spacing.xs },
  titleCentered: { textAlign: "center" },
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
  tabRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  tabChip: {
    flex: 1,
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  tabChipActive: { backgroundColor: colors.indigo[400], borderColor: colors.indigo[400] },
  tabIcon: { marginRight: 4 },
  tabText: { color: colors.textSecondary },
  tabTextActive: { color: colors.neutral.white },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  inputRowIcon: { marginRight: spacing.sm },
  inputRowField: {
    flex: 1,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
    fontSize: 16,
    fontFamily: typography.body.fontFamily,
  },
  contactCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.indigo[100],
    alignItems: "center",
    justifyContent: "center",
  },
  contactAvatarText: { color: colors.indigo[700], fontWeight: "700" },
  contactBody: { flex: 1 },
  contactName: { color: colors.textPrimary },
  contactSending: { color: colors.textSecondary, marginTop: 1 },
  qrPlaceholder: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
  },
  qrPlaceholderText: { color: colors.textSecondary, textAlign: "center" },
  balanceHint: { color: colors.textSecondary, marginTop: spacing.xs },
  availablePill: {
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  availablePillLabel: { color: colors.textSecondary },
  availablePillValue: { color: colors.indigo[900] },
  spendableHint: { color: colors.textSecondary, textAlign: "center", marginBottom: spacing.md, marginTop: -spacing.xs },
  amountLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sendMaxLink: { color: colors.terracotta[500], fontWeight: "700" },
  errorHint: { color: colors.danger, marginTop: spacing.xs },
  resolveRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  resolveText: { color: colors.textSecondary },
  resolveSuccess: { color: colors.success, marginTop: spacing.xs },
  preflightCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  preflightTitle: { color: colors.textSecondary, marginBottom: spacing.xs },
  preflightRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  preflightLabel: { color: colors.textPrimary },
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
  desktopRow: { flexDirection: "row", gap: spacing.xl, alignItems: "flex-start" },
  desktopFormCol: { flex: 1, minWidth: 320 },
  historyCol: { flex: 1.4, minWidth: 380 },
  cardTitle: { color: colors.textPrimary },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  historyCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: spacing.lg },
  historyCardSubtitle: { color: colors.textSecondary, marginTop: 2 },
  exportButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  exportButtonText: { color: colors.indigo[500] },
  historyTableHeader: {
    flexDirection: "row",
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyTableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyCellText: { color: colors.textPrimary },
  thDate: { flex: 1.2 },
  thType: { flex: 1 },
  thCounterparty: { flex: 1.6 },
  thAmount: { flex: 1.2, textAlign: "right" },
  thStatus: { flex: 1, alignItems: "flex-end" },
  historyStatusPill: { backgroundColor: colors.indigo[100], borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  historyStatusPillText: { color: colors.indigo[700] },
  statusText: { color: colors.textSecondary },
});
