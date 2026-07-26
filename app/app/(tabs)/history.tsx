import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Linking, ActivityIndicator, Platform } from "react-native";
import { colors } from "../../src/theme/colors";
import { typography, fonts, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { useWallet } from "../../src/hooks/useWallet";
import { useTransactionHistory } from "../../src/hooks/useTransactionHistory";
import { TxRecord, TxDirection } from "../../src/services/contractEvents";
import { whToUnits } from "../../src/services/units";
import { exportTransactionsCsv, exportBillingReportPdf } from "../../src/services/exportReport";

const isWeb = Platform.OS === "web";

const CONSUMPTION_DAYS = 14;

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Buckets burn transactions into the trailing 14 calendar days for the
 * Consumption tab's chart + daily table -- same underlying event data as
 * the transaction list below, just aggregated per day. */
function useDailyConsumption(transactions: TxRecord[]) {
  return useMemo(() => {
    const now = Date.now();
    const cutoff = now - CONSUMPTION_DAYS * 24 * 60 * 60 * 1000;
    const byDay = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.direction !== "burn" || tx.timestamp < cutoff) continue;
      const key = dayKey(tx.timestamp);
      byDay.set(key, (byDay.get(key) ?? 0) + tx.amountWh);
    }
    const days: { key: string; label: string; wh: number }[] = [];
    for (let i = CONSUMPTION_DAYS - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = dayKey(d.getTime());
      days.push({
        key,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        wh: byDay.get(key) ?? 0,
      });
    }
    return days;
  }, [transactions]);
}

function ConsumptionChart({ days }: { days: { key: string; label: string; wh: number }[] }) {
  const maxWh = Math.max(...days.map((d) => d.wh), 1);
  const totalWh = days.reduce((s, d) => s + d.wh, 0);
  return (
    <View style={styles.consumptionSection}>
      <View style={styles.consumptionChart}>
        {days.map((day) => (
          <View key={day.key} style={styles.consumptionBarWrap}>
            <View style={styles.consumptionBarTrack}>
              <View
                style={[
                  styles.consumptionBarFill,
                  { height: `${Math.max(2, (day.wh / maxWh) * 100)}%` },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
      <Text style={[typography.caption, styles.consumptionSummary]}>
        Last {CONSUMPTION_DAYS} days: {whToUnits(totalWh).toLocaleString()} units consumed
      </Text>
      <View style={styles.dailyTable}>
        {days
          .filter((d) => d.wh > 0)
          .slice()
          .reverse()
          .map((day) => (
            <View key={day.key} style={styles.dailyTableRow}>
              <Text style={[typography.caption, styles.dailyTableLabel]}>{day.label}</Text>
              <Text style={[typography.dataXs, styles.dailyTableValue]}>{day.wh.toLocaleString()} Wh</Text>
            </View>
          ))}
        {days.every((d) => d.wh === 0) && (
          <Text style={[typography.caption, styles.statusText]}>No consumption recorded in this window.</Text>
        )}
      </View>
    </View>
  );
}

const AMOY_EXPLORER_TX = "https://amoy.polygonscan.com/tx/";

const DIRECTION_META: Record<TxDirection, { label: string; symbol: string; color: string }> = {
  mint: { label: "Purchased", symbol: "+", color: colors.success },
  "transfer-in": { label: "Received", symbol: "+", color: colors.success },
  "transfer-out": { label: "Sent", symbol: "−", color: colors.terracotta[400] },
  burn: { label: "Consumed", symbol: "−", color: colors.textSecondary },
};

type FilterTab = "transactions" | "consumption";

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "transactions", label: "Transactions" },
  { key: "consumption", label: "Consumption" },
];

function matchesFilter(direction: TxDirection, filter: FilterTab): boolean {
  if (filter === "transactions") return direction !== "burn";
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
    <View style={styles.card}>
      <View style={[styles.symbolBadge, { backgroundColor: meta.color }]}>
        <Text style={styles.symbolText}>{meta.symbol}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={[typography.bodyStrong, styles.rowTitle]}>{meta.label}</Text>
        <Text style={[typography.caption, styles.rowCounterparty]}>
          {formatCounterparty(tx.counterparty)} · {formatTimestamp(tx.timestamp)}
        </Text>
        <Pressable onPress={() => Linking.openURL(`${AMOY_EXPLORER_TX}${tx.hash}`)}>
          <Text style={[typography.dataXs, styles.rowLink]}>{tx.hash.slice(0, 10)}…{tx.hash.slice(-6)} ↗</Text>
        </Pressable>
      </View>
      <View style={styles.rowRight}>
        <Text style={[typography.dataSm, { color: meta.color }]}>
          {meta.symbol}{tx.amountWh.toLocaleString()} Wh
        </Text>
        <View style={styles.statusPill}>
          <Text style={[typography.dataXs, styles.statusPillText]}>Confirmed</Text>
        </View>
      </View>
    </View>
  );
}

/** Reads real Transfer/Minted/Consumed event logs for this wallet from Polygon Amoy. */
export default function HistoryScreen() {
  const { walletAddress } = useWallet();
  const { transactions, loading, error, refresh } = useTransactionHistory(walletAddress);
  const [filter, setFilter] = useState<FilterTab>("transactions");

  const filteredTransactions = useMemo(
    () => transactions.filter((tx) => matchesFilter(tx.direction, filter)),
    [transactions, filter]
  );
  const dailyConsumption = useDailyConsumption(transactions);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={[typography.h1, styles.headerTitle]}>History</Text>
        <View style={styles.headerRight}>
          {isWeb && walletAddress && transactions.length > 0 && (
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

      <View style={styles.filterRow}>
        {FILTER_TABS.map((tab) => (
          <Pressable key={tab.key} onPress={() => setFilter(tab.key)} style={styles.filterTab}>
            <Text
              style={[
                typography.label,
                filter === tab.key ? styles.filterTabTextActive : styles.filterTabText,
              ]}
            >
              {tab.label.toUpperCase()}
            </Text>
            {filter === tab.key && <View style={styles.filterTabUnderline} />}
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

      {!loading && !error && filter === "consumption" && transactions.length > 0 && (
        <ConsumptionChart days={dailyConsumption} />
      )}

      {!loading && !error && transactions.length === 0 && (
        <Text style={[typography.caption, styles.statusText, styles.emptyText]}>
          No transactions yet for this wallet.
        </Text>
      )}

      {!loading && !error && transactions.length > 0 && filteredTransactions.length === 0 && (
        <Text style={[typography.caption, styles.statusText, styles.emptyText]}>
          No {FILTER_TABS.find((t) => t.key === filter)?.label.toLowerCase()} yet.
        </Text>
      )}

      {filter === "transactions" && (
        <FlatList
          data={filteredTransactions}
          keyExtractor={(item) => item.hash}
          renderItem={({ item }) => <TransactionRow tx={item} />}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshing={loading}
          onRefresh={refresh}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: isWeb
    ? { flex: 1, backgroundColor: colors.background, width: "100%", maxWidth: 900, alignSelf: "center", paddingTop: spacing.lg }
    : { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: { color: colors.textPrimary },
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
  filterRow: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterTab: { paddingBottom: spacing.sm, alignItems: "center" },
  filterTabText: { color: colors.textSecondary },
  filterTabTextActive: { color: colors.indigo[500] },
  filterTabUnderline: {
    position: "absolute",
    bottom: -1,
    height: 2,
    width: "100%",
    backgroundColor: colors.indigo[500],
  },
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
  consumptionSection: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  consumptionChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 90,
    gap: 3,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  consumptionBarWrap: { flex: 1, height: "100%", justifyContent: "flex-end" },
  consumptionBarTrack: { flex: 1, justifyContent: "flex-end" },
  consumptionBarFill: { width: "100%", borderRadius: 2, minHeight: 2, backgroundColor: colors.indigo[400] },
  consumptionSummary: { color: colors.textSecondary, marginTop: spacing.sm },
  dailyTable: { marginTop: spacing.sm, gap: spacing.xs },
  dailyTableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dailyTableLabel: { color: colors.textSecondary },
  dailyTableValue: { color: colors.textPrimary },
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
  symbolText: { color: colors.neutral.white, fontFamily: fonts.monoBold, fontSize: 16 },
  rowBody: { flex: 1, marginLeft: spacing.md },
  rowTitle: { color: colors.textPrimary },
  rowCounterparty: { color: colors.textSecondary, marginTop: 2 },
  rowLink: { color: colors.indigo[400], marginTop: 2 },
  rowRight: { alignItems: "flex-end", gap: 4 },
  statusPill: {
    backgroundColor: colors.indigo[100],
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusPillText: { color: colors.indigo[700] },
});
