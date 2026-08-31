import React from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Linking, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { useWallet } from "../../src/hooks/useWallet";
import { useTransactionHistory } from "../../src/hooks/useTransactionHistory";
import { TxRecord, TxDirection } from "../../src/services/contractEvents";
import { exportTransactionsCsv, exportBillingReportPdf } from "../../src/services/exportReport";
import { whToUnits } from "../../src/services/units";
import { useIsDesktopWeb } from "../../src/hooks/useIsDesktopWeb";
import { MobileTopBar } from "../../src/components/MobileTopBar";

const EXPLORER_TX = "https://sepolia.etherscan.io/tx/";

const DIRECTION_META: Record<
  TxDirection,
  { label: string; symbol: string; amountColor: string; icon: keyof typeof Ionicons.glyphMap; badgeTint: string; iconColor: string }
> = {
  mint: { label: "Purchased", symbol: "+", amountColor: colors.terracotta[500], icon: "add-circle-outline", badgeTint: colors.indigo[100], iconColor: colors.indigo[900] },
  "transfer-in": { label: "Received", symbol: "+", amountColor: colors.terracotta[500], icon: "arrow-down-outline", badgeTint: colors.indigo[100], iconColor: colors.indigo[900] },
  "transfer-out": { label: "Sent", symbol: "−", amountColor: colors.textPrimary, icon: "arrow-up-outline", badgeTint: colors.neutral[100], iconColor: colors.textSecondary },
  burn: { label: "Consumed", symbol: "−", amountColor: colors.textPrimary, icon: "flash-outline", badgeTint: colors.neutral[100], iconColor: colors.textSecondary },
};

function formatTimestamp(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatCounterparty(counterparty: string) {
  return counterparty.startsWith("0x") ? `${counterparty.slice(0, 6)}…${counterparty.slice(-4)}` : counterparty;
}

function TransactionRow({ tx }: { tx: TxRecord }) {
  const meta = DIRECTION_META[tx.direction];
  return (
    <View style={styles.card}>
      <View style={[styles.symbolBadge, { backgroundColor: meta.badgeTint }]}>
        <Ionicons name={meta.icon} size={18} color={meta.iconColor} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[typography.bodyStrong, styles.rowTitle]}>{meta.label}</Text>
        <Text style={[typography.caption, styles.rowCounterparty]}>
          {formatCounterparty(tx.counterparty)} · {formatTimestamp(tx.timestamp)}
        </Text>
        <Pressable onPress={() => Linking.openURL(`${EXPLORER_TX}${tx.hash}`)}>
          <Text style={[typography.dataXs, styles.rowLink]}>{tx.hash.slice(0, 10)}…{tx.hash.slice(-6)} ↗</Text>
        </Pressable>
      </View>
      <View style={styles.rowRight}>
        <Text style={[typography.dataSm, { color: meta.amountColor }]}>
          {meta.symbol}{whToUnits(tx.amountWh).toLocaleString()} units
        </Text>
        <Text style={[typography.dataXs, styles.rowAmountWh]}>{tx.amountWh.toLocaleString()} Wh</Text>
        <View style={styles.statusPill}>
          <Text style={[typography.dataXs, styles.statusPillText]}>Confirmed</Text>
        </View>
      </View>
    </View>
  );
}

/** Reads real Transfer/Minted/Consumed event logs for this wallet from Sepolia. */
/**
 * Reached from Profile's "Transaction History" row, not a tab -- this is a
 * wallet ledger (mint/burn/transfer events with hashes), which fits next to
 * the wallet address and export tools better than next to the physical
 * energy side. No consumption chart here anymore either: Budget's allowance-
 * vs-actual trend and Dashboard's live power graph already covered that
 * same data two other ways, and this list already shows every burn with its
 * exact amount and timestamp for anyone who wants the raw detail.
 */
export default function HistoryScreen() {
  const isDesktop = useIsDesktopWeb();
  const router = useRouter();
  const { walletAddress } = useWallet();
  const { transactions, loading, error, refresh } = useTransactionHistory(walletAddress);

  return (
    <View style={[styles.screen, isDesktop && styles.screenDesktop]}>
      {isDesktop ? (
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backRow} hitSlop={8}>
            <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
            <Text style={[typography.h1, styles.headerTitle]}>History</Text>
          </Pressable>
          <View style={styles.headerRight}>
            {walletAddress && transactions.length > 0 && (
              <>
                <Pressable
                  style={styles.exportButton}
                  onPress={() => exportTransactionsCsv(transactions, walletAddress)}
                >
                  <Text style={[typography.dataXs, styles.exportButtonText]}>Export CSV</Text>
                </Pressable>
                <Pressable
                  style={styles.exportButton}
                  onPress={() => exportBillingReportPdf(transactions, walletAddress)}
                >
                  <Text style={[typography.dataXs, styles.exportButtonText]}>Billing PDF</Text>
                </Pressable>
              </>
            )}
            <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
          </View>
        </View>
      ) : (
        <View style={styles.mobileHeader}>
          <MobileTopBar />
          <View style={styles.heroBand}>
            <Pressable onPress={() => router.back()} style={styles.backRow} hitSlop={8}>
              <Ionicons name="arrow-back" size={20} color={colors.indigo[700]} />
              <Text style={[typography.display, styles.heroBandTitle]}>History</Text>
            </Pressable>
          </View>
        </View>
      )}

      {loading && (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.indigo[400]} />
          <Text style={[typography.caption, styles.statusText]}>Reading chain history…</Text>
        </View>
      )}

      {!loading && error && (
        <View style={styles.statusRow}>
          <Text style={[typography.caption, styles.errorText]}>Can't load right now.</Text>
          <Pressable onPress={refresh}>
            <Text style={[typography.caption, styles.retryText]}>Retry</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && transactions.length === 0 && (
        <Text style={[typography.caption, styles.statusText, styles.emptyText]}>
          No transactions yet for this wallet.
        </Text>
      )}

      {!loading && !error && transactions.length > 0 && (
        <Text style={[typography.caption, styles.statusText, styles.windowNote]}>
          Showing activity from roughly the last 1.5–2 hours.
        </Text>
      )}

      <FlatList
        data={transactions}
        keyExtractor={(item) => item.hash}
        renderItem={({ item }) => <TransactionRow tx={item} />}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        refreshing={loading}
        onRefresh={refresh}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenDesktop: { width: "100%", maxWidth: 900, alignSelf: "center", paddingTop: spacing.lg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: { color: colors.textPrimary },
  backRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  mobileHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, marginBottom: spacing.sm, gap: spacing.md },
  heroBand: { backgroundColor: colors.indigo[900], borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  heroBandTitle: { color: colors.indigo[700], fontSize: 28 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  exportButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  exportButtonText: { color: colors.indigo[400] },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  statusText: { color: colors.textSecondary },
  errorText: { color: colors.danger },
  retryText: { color: colors.indigo[400], textDecorationLine: "underline" },
  emptyText: { paddingHorizontal: spacing.lg },
  windowNote: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  symbolBadge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, marginLeft: spacing.md },
  rowTitle: { color: colors.textPrimary },
  rowCounterparty: { color: colors.textSecondary, marginTop: 2 },
  rowLink: { color: colors.indigo[400], marginTop: 2 },
  rowRight: { alignItems: "flex-end", gap: 4 },
  rowAmountWh: { color: colors.textSecondary, opacity: 0.85 },
  statusPill: {
    backgroundColor: colors.indigo[100],
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusPillText: { color: colors.indigo[700] },
});
