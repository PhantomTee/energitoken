import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Linking, ActivityIndicator } from "react-native";
import { colors } from "../../src/theme/colors";
import { typography, fonts, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { useWallet } from "../../src/hooks/useWallet";
import { useTransactionHistory } from "../../src/hooks/useTransactionHistory";
import { TxRecord, TxDirection } from "../../src/services/contractEvents";

const AMOY_EXPLORER_TX = "https://amoy.polygonscan.com/tx/";

const DIRECTION_META: Record<TxDirection, { label: string; symbol: string; color: string }> = {
  mint: { label: "Purchased", symbol: "+", color: colors.success },
  "transfer-in": { label: "Received", symbol: "+", color: colors.success },
  "transfer-out": { label: "Sent", symbol: "−", color: colors.terracotta[400] },
  burn: { label: "Consumed", symbol: "−", color: colors.textSecondary },
};

type FilterTab = "all" | "received" | "sent" | "consumption";

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "received", label: "Received" },
  { key: "sent", label: "Sent" },
  { key: "consumption", label: "Consumption" },
];

function matchesFilter(direction: TxDirection, filter: FilterTab): boolean {
  if (filter === "all") return true;
  if (filter === "received") return direction === "mint" || direction === "transfer-in";
  if (filter === "sent") return direction === "transfer-out";
  return direction === "burn"; // consumption
}

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
    <View style={styles.row}>
      <View style={[styles.symbolBadge, { backgroundColor: meta.color }]}>
        <Text style={styles.symbolText}>{meta.symbol}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={[typography.bodyStrong, styles.rowTitle]}>{meta.label}</Text>
        <Text style={[typography.caption, styles.rowCounterparty]}>{formatCounterparty(tx.counterparty)}</Text>
        <Pressable onPress={() => Linking.openURL(`${AMOY_EXPLORER_TX}${tx.hash}`)}>
          <Text style={[typography.dataXs, styles.rowLink]}>{tx.hash.slice(0, 10)}…{tx.hash.slice(-6)} ↗</Text>
        </Pressable>
      </View>
      <View style={styles.rowRight}>
        <Text style={[typography.dataSm, { color: meta.color }]}>
          {meta.symbol}{tx.amountWh.toLocaleString()} Wh
        </Text>
        <Text style={[typography.dataXs, styles.rowTime]}>{formatTimestamp(tx.timestamp)}</Text>
      </View>
    </View>
  );
}

/** Reads real Transfer/Minted/Consumed event logs for this wallet from Polygon Amoy. */
export default function HistoryScreen() {
  const { walletAddress } = useWallet();
  const { transactions, loading, error, refresh } = useTransactionHistory(walletAddress);
  const [filter, setFilter] = useState<FilterTab>("all");

  const filteredTransactions = useMemo(
    () => transactions.filter((tx) => matchesFilter(tx.direction, filter)),
    [transactions, filter]
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={[typography.h1, styles.headerTitle]}>History</Text>
        <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
      </View>

      <View style={styles.filterRow}>
        {FILTER_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setFilter(tab.key)}
            style={[styles.filterChip, filter === tab.key && styles.filterChipActive]}
          >
            <Text style={[typography.caption, filter === tab.key ? styles.filterTextActive : styles.filterText]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

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

      {!loading && !error && transactions.length > 0 && filteredTransactions.length === 0 && (
        <Text style={[typography.caption, styles.statusText, styles.emptyText]}>
          No {FILTER_TABS.find((t) => t.key === filter)?.label.toLowerCase()} transactions yet.
        </Text>
      )}

      <FlatList
        data={filteredTransactions}
        keyExtractor={(item) => item.hash}
        renderItem={({ item }) => <TransactionRow tx={item} />}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={loading}
        onRefresh={refresh}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: { color: colors.textPrimary },
  filterRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  filterChipActive: { backgroundColor: colors.indigo[400], borderColor: colors.indigo[400] },
  filterText: { color: colors.textSecondary },
  filterTextActive: { color: colors.neutral.white },
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
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md },
  symbolBadge: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  symbolText: { color: colors.neutral.white, fontFamily: fonts.monoBold, fontSize: 16 },
  rowBody: { flex: 1, marginLeft: spacing.md },
  rowTitle: { color: colors.textPrimary },
  rowCounterparty: { color: colors.textSecondary, marginTop: 2 },
  rowLink: { color: colors.indigo[400], marginTop: 2 },
  rowRight: { alignItems: "flex-end" },
  rowTime: { color: colors.textSecondary, marginTop: 2 },
  separator: { height: 1, backgroundColor: colors.border },
});
